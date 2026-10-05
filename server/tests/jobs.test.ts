import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { isDeepStrictEqual } from 'node:util';
import { app } from '../src/app';
import { config } from '../src/config';
import * as dbModule from '../src/db';
import type { DbExecutor } from '../src/db';
import { JobRow } from '../src/controllers/jobController';
import { queueService, queueObservability } from '../src/queue';

interface MockUser {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

let mockUsers: MockUser[] = [];
let mockJobs: JobRow[] = [];
let enqueuedIds: string[] = [];
let retriedIds: string[] = [];
let jobInsertStatements: string[] = [];
let mockIdempotencyKeys = new Map<string, { job: JobRow; type: string; payload: Record<string, unknown>; priority: number }>();
let mockJobSequence = 0;
let outboxEvents: { jobId: string; eventType: string }[] = [];
let transactionStatements: string[][] = [];

// Helper to create an auth cookie for a test user
const createAuthCookie = (user: { id: string; name: string; email: string }) => {
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    config.jwtSecret,
    { expiresIn: '1h' }
  );
  return `token=${token}`;
};

// Setup DB mock for users and jobs
(dbModule.db as unknown as { query: typeof dbModule.db.query }).query = (async (
  text: string,
  params: unknown[] = []
) => {
  const queryStr = text.trim();

  // 1. SELECT user by id (auth/me)
  if (queryStr.includes('SELECT id, name, email, created_at FROM users WHERE id = $1')) {
    const idToFind = String(params[0]);
    const user = mockUsers.find((u) => u.id === idToFind);
    return { rows: user ? [user] : [], command: 'SELECT', rowCount: user ? 1 : 0, oid: 0, fields: [] };
  }

  // 2. INSERT into jobs
  if (queryStr.includes('INSERT INTO outbox_events')) {
    outboxEvents.push({ jobId: String(params[0]), eventType: 'job.dispatch' });
    return { rows: [], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
  }

  if (queryStr.includes('INSERT INTO jobs')) {
    jobInsertStatements.push(queryStr);
    const [userId, type, payloadStr, priority, rawIdempotencyKey] = params as [string, string, string, number, string | null];
    const payload = JSON.parse(payloadStr || '{}') as Record<string, unknown>;
    const key = rawIdempotencyKey ? `${userId}:${rawIdempotencyKey}` : null;
    if (key && mockIdempotencyKeys.has(key)) {
      return { rows: [], command: 'INSERT', rowCount: 0, oid: 0, fields: [] };
    }
    const newJob: JobRow = {
      id: `a0000000-0000-4000-8000-${String(++mockJobSequence).padStart(12, '0')}`,
      user_id: userId,
      type,
      payload,
      status: 'waiting',
      priority: Number(priority),
      attempts: 0,
      result: null,
      error: null,
      created_at: new Date(),
      updated_at: new Date(),
      started_at: null,
      completed_at: null
    };
    mockJobs.push(newJob);
    if (key) mockIdempotencyKeys.set(key, { job: newJob, type, payload, priority: Number(priority) });
    return { rows: [newJob], command: 'INSERT', rowCount: 1, oid: 0, fields: [] };
  }

  if (queryStr.includes('AS same_request') && queryStr.includes('idempotency_key = $2')) {
    const [userId, idempotencyKey, type, priority, payloadText] = params as [string, string, string, number, string];
    const saved = mockIdempotencyKeys.get(`${userId}:${idempotencyKey}`);
    const requestedPayload = JSON.parse(payloadText) as Record<string, unknown>;
    const sameRequest = Boolean(saved && saved.type === type && saved.priority === Number(priority) &&
      isDeepStrictEqual(saved.payload, requestedPayload));
    return {
      rows: saved ? [{ ...saved.job, same_request: sameRequest }] : [],
      command: 'SELECT', rowCount: saved ? 1 : 0, oid: 0, fields: []
    };
  }

  if (queryStr.startsWith('UPDATE jobs SET status = \'failed\', error = $2')) {
    const job = mockJobs.find((item) => item.id === String(params[0]));
    if (job) { job.status = 'failed'; job.error = String(params[1]); job.completed_at = new Date(); }
    return { rows: job ? [job] : [], command: 'UPDATE', rowCount: job ? 1 : 0, oid: 0, fields: [] };
  }

  if (queryStr.startsWith("UPDATE jobs SET status = 'waiting', error = NULL")) {
    const job = mockJobs.find((item) => item.id === String(params[0]) && item.user_id === String(params[1]) && item.status === 'failed');
    if (job) {
      job.status = 'waiting'; job.error = null; job.result = null; job.started_at = null; job.completed_at = null;
    }
    return { rows: job ? [job] : [], command: 'UPDATE', rowCount: job ? 1 : 0, oid: 0, fields: [] };
  }

  // 3. SELECT COUNT(*) FROM jobs
  if (queryStr.toLowerCase().includes('select count(*)::text as count from jobs')) {
    const userId = String(params[0]);
    let filtered = mockJobs.filter((j) => j.user_id === userId);
    if (params.length > 1 && params[1]) {
      const statusFilter = String(params[1]).toLowerCase();
      filtered = filtered.filter((j) => j.status === statusFilter);
    }
    return {
      rows: [{ count: String(filtered.length) }],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: []
    };
  }

  // 4. SELECT jobs for user with pagination
  if (queryStr.includes('SELECT id, user_id, type, payload, status, priority, attempts, result, error, created_at, updated_at, started_at, completed_at') &&
      queryStr.includes('FROM jobs') && queryStr.includes('LIMIT')) {
    const userId = String(params[0]);
    let filtered = mockJobs.filter((j) => j.user_id === userId);

    let limitIndex = 1;
    let offsetIndex = 2;
    if (params.length === 4) {
      const statusFilter = String(params[1]).toLowerCase();
      filtered = filtered.filter((j) => j.status === statusFilter);
      limitIndex = 2;
      offsetIndex = 3;
    }

    const limit = Number(params[limitIndex]) || 10;
    const offset = Number(params[offsetIndex]) || 0;

    // Sort created_at DESC
    filtered.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    const paginated = filtered.slice(offset, offset + limit);

    return {
      rows: paginated,
      command: 'SELECT',
      rowCount: paginated.length,
      oid: 0,
      fields: []
    };
  }

  // 5. Job stats aggregation
  if (queryStr.includes('SELECT') && queryStr.includes('COUNT(*) FILTER (WHERE status = \'waiting\')')) {
    const userId = String(params[0]);
    const userJobs = mockJobs.filter((j) => j.user_id === userId);

    return {
      rows: [
        {
          total: userJobs.length,
          waiting: userJobs.filter((j) => j.status === 'waiting').length,
          active: userJobs.filter((j) => j.status === 'active').length,
          completed: userJobs.filter((j) => j.status === 'completed').length,
          failed: userJobs.filter((j) => j.status === 'failed').length,
          delayed: userJobs.filter((j) => j.status === 'delayed').length,
          cancelled: userJobs.filter((j) => j.status === 'cancelled').length
        }
      ],
      command: 'SELECT',
      rowCount: 1,
      oid: 0,
      fields: []
    };
  }

  // 6. DELETE job; this check must precede the generic ownership SELECT matcher.
  if (queryStr.includes('DELETE FROM jobs WHERE id = $1 AND user_id = $2')) {
    const id = String(params[0]);
    const userId = String(params[1]);
    const index = mockJobs.findIndex((j) => j.id === id && j.user_id === userId && j.status !== 'active');
    if (index !== -1) {
      mockJobs.splice(index, 1);
      return { rows: [{ id }], command: 'DELETE', rowCount: 1, oid: 0, fields: [] };
    }
    return { rows: [], command: 'DELETE', rowCount: 0, oid: 0, fields: [] };
  }

  // 7. SELECT single job by id and user_id
  if (queryStr.includes('WHERE id = $1 AND user_id = $2')) {
    const id = String(params[0]);
    const userId = String(params[1]);
    const job = mockJobs.find((j) => j.id === id && j.user_id === userId);
    return {
      rows: job ? [job] : [],
      command: 'SELECT',
      rowCount: job ? 1 : 0,
      oid: 0,
      fields: []
    };
  }

  return { rows: [], command: 'SELECT', rowCount: 0, oid: 0, fields: [] };
}) as unknown as typeof dbModule.db.query;

(dbModule.db as unknown as { transaction: typeof dbModule.db.transaction }).transaction = async (callback) => {
  const statements: string[] = [];
  transactionStatements.push(statements);
  const executor: DbExecutor = {
    query: (async (text: string, params?: unknown[]) => {
      statements.push(text);
      return dbModule.db.query(text, params);
    }) as DbExecutor['query']
  };
  return callback(executor);
};

describe('TaskFlow Job Management API Tests', () => {
  const userA = { id: 'usr_aaaa_1111', name: 'User A', email: 'user.a@example.com' };
  const userB = { id: 'usr_bbbb_2222', name: 'User B', email: 'user.b@example.com' };
  const authCookieA = createAuthCookie(userA);
  const authCookieB = createAuthCookie(userB);

  beforeEach(() => {
    mockJobs = [];
    enqueuedIds = [];
    retriedIds = [];
    jobInsertStatements = [];
    mockIdempotencyKeys = new Map();
    mockJobSequence = 0;
    outboxEvents = [];
    transactionStatements = [];
    queueService.enqueue = async (id) => { enqueuedIds.push(id); };
    queueService.retryFailed = async (id) => { retriedIds.push(id); };
    queueService.consumeSubmissionRateLimit = async () => ({ allowed: true, limit: 60, remaining: 59, resetSeconds: 60 });
    queueService.recordSubmissionRejection = async () => undefined;
    queueObservability.pressure = async () => ({ waiting: 0, pending: 0, maxWaiting: 10000, maxPending: 20000, overloaded: false });
    mockUsers = [
      {
        id: userA.id,
        name: userA.name,
        email: userA.email,
        password_hash: 'hash',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: userB.id,
        name: userB.name,
        email: userB.email,
        password_hash: 'hash',
        created_at: new Date(),
        updated_at: new Date()
      }
    ];
  });

  describe('Authentication protection', () => {
    test('POST /api/v1/jobs rejects unauthenticated requests with 401', async () => {
      const res = await request(app).post('/api/v1/jobs').send({ type: 'email:send' });
      assert.equal(res.status, 401);
    });

    test('GET /api/v1/jobs rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/jobs');
      assert.equal(res.status, 401);
    });

    test('GET /api/v1/jobs/:id rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/jobs/11111111-1111-4111-8111-111111111111');
      assert.equal(res.status, 401);
    });

    test('DELETE /api/v1/jobs/:id rejects unauthenticated requests with 401', async () => {
      const res = await request(app).delete('/api/v1/jobs/11111111-1111-4111-8111-111111111111');
      assert.equal(res.status, 401);
    });

    test('POST /api/v1/jobs/:id/retry rejects unauthenticated requests with 401', async () => {
      const res = await request(app).post('/api/v1/jobs/11111111-1111-4111-8111-111111111111/retry');
      assert.equal(res.status, 401);
    });
  });

  test('malformed JSON receives a 400 response', async () => {
    const res = await request(app)
      .post('/api/v1/jobs')
      .set('Cookie', authCookieA)
      .set('Content-Type', 'application/json')
      .send('{');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Request body contains invalid JSON');
  });

  describe('POST /api/v1/jobs (Create Job)', () => {
    test('rejects job creation with missing or empty type', async () => {
      const res = await request(app)
        .post('/api/v1/jobs')
        .set('Cookie', authCookieA)
        .send({ type: '   ', priority: 'normal' });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /Job type is required/);
    });

    test('rejects job creation with invalid priority', async () => {
      const res = await request(app)
        .post('/api/v1/jobs')
        .set('Cookie', authCookieA)
        .send({ type: 'email', priority: 'ultra-high' });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /Invalid priority/);
    });

    test('rejects a non-object payload', async () => {
      const res = await request(app)
        .post('/api/v1/jobs')
        .set('Cookie', authCookieA)
        .send({ type: 'email', payload: ['not', 'an', 'object'] });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /Payload must be a JSON object/);
    });

    test('creates job successfully with default status "waiting" and attempts 0', async () => {
      const res = await request(app)
        .post('/api/v1/jobs')
        .set('Cookie', authCookieA)
        .send({
          type: 'report',
          priority: 'high',
          payload: { reportId: 'rep_123', month: 'October' }
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.job.type, 'report');
      assert.equal(res.body.job.priority, 'high');
      assert.equal(res.body.job.status, 'waiting');
      assert.equal(res.body.job.attempts, 0);
      assert.equal(res.body.job.userId, userA.id);
      assert.deepEqual(res.body.job.payload, { reportId: 'rep_123', month: 'October' });
      assert.ok(res.body.job.id);
      assert.deepEqual(enqueuedIds, []);
      assert.deepEqual(outboxEvents, [{ jobId: res.body.job.id, eventType: 'job.dispatch' }]);
      assert.match(transactionStatements[0][0], /pg_advisory_xact_lock/);
      assert.match(transactionStatements[0][1], /FROM outbox_events WHERE status/);
      assert.match(transactionStatements[0][2], /INSERT INTO jobs/);
      assert.match(transactionStatements[0][3], /INSERT INTO outbox_events/);
    });

    test('creates a new job with an idempotency key', async () => {
      const res = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA)
        .set('Idempotency-Key', 'create-report-1').send({ type: 'report', payload: { month: 'October' } });
      assert.equal(res.status, 201);
      assert.equal(mockJobs.length, 1);
      assert.deepEqual(enqueuedIds, []);
      assert.equal(outboxEvents.length, 1);
      assert.match(jobInsertStatements[0], /ON CONFLICT \(user_id, idempotency_key\) DO NOTHING\s+RETURNING/i);
    });

    test('returns the same job for an identical key and creates one outbox event', async () => {
      const input = { type: 'report', priority: 'normal', payload: { month: 'October', year: 2026 } };
      const first = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA)
        .set('Idempotency-Key', 'same-report').send(input);
      const replay = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA)
        .set('Idempotency-Key', 'same-report').send({ ...input, payload: { year: 2026, month: 'October' } });
      assert.equal(first.status, 201);
      assert.equal(replay.status, 200);
      assert.equal(replay.body.job.id, first.body.job.id);
      assert.equal(mockJobs.length, 1);
      assert.deepEqual(enqueuedIds, []);
      assert.equal(outboxEvents.length, 1);
    });

    test('idempotent replay remains available at queue capacity without creating a duplicate', async () => {
      const input = { type: 'report', payload: { name: 'same' } };
      const first = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA)
        .set('Idempotency-Key', 'capacity-replay').send(input);
      queueObservability.pressure = async () => ({ waiting: 10000, pending: 10000, maxWaiting: 10000, maxPending: 20000, overloaded: true });
      const replay = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA)
        .set('Idempotency-Key', 'capacity-replay').send(input);
      assert.equal(first.status, 201);
      assert.equal(replay.status, 200);
      assert.equal(replay.body.job.id, first.body.job.id);
      assert.equal(mockJobs.length, 1);
      assert.equal(outboxEvents.length, 1);
    });

    test('queue backpressure rejects new work and accepts it after pressure recovers', async () => {
      queueObservability.pressure = async () => ({ waiting: 10000, pending: 10000, maxWaiting: 10000, maxPending: 20000, overloaded: true });
      const rejected = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA).send({ type: 'report' });
      assert.equal(rejected.status, 503);
      assert.equal(rejected.body.code, 'QUEUE_BACKPRESSURE');
      assert.equal(rejected.headers['retry-after'], '5');
      assert.equal(mockJobs.length, 0);
      assert.equal(outboxEvents.length, 0);
      queueObservability.pressure = async () => ({ waiting: 0, pending: 0, maxWaiting: 10000, maxPending: 20000, overloaded: false });
      const accepted = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA).send({ type: 'report' });
      assert.equal(accepted.status, 201);
      assert.equal(mockJobs.length, 1);
      assert.equal(outboxEvents.length, 1);
    });

    test('rate limiting does not create or duplicate jobs when a request is rejected', async () => {
      let calls = 0;
      queueService.consumeSubmissionRateLimit = async () => {
        calls += 1;
        return { allowed: calls === 1, limit: 1, remaining: 0, resetSeconds: 60 };
      };
      const input = { type: 'report', payload: { safe: true } };
      const first = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA).set('Idempotency-Key', 'rate-key').send(input);
      const blocked = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA).set('Idempotency-Key', 'rate-key').send(input);
      assert.equal(first.status, 201);
      assert.equal(blocked.status, 429);
      assert.equal(blocked.headers['ratelimit-limit'], '1');
      assert.equal(mockJobs.length, 1);
      assert.equal(outboxEvents.length, 1);
    });

    test('rejects a key reused with different type, priority, or payload', async () => {
      const input = { type: 'report', priority: 'normal', payload: { month: 'October' } };
      const first = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA)
        .set('Idempotency-Key', 'mismatched-request').send(input);
      assert.equal(first.status, 201);
      for (const changed of [
        { ...input, type: 'email' },
        { ...input, priority: 'high' },
        { ...input, payload: { month: 'November' } }
      ]) {
        const replay = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA)
          .set('Idempotency-Key', 'mismatched-request').send(changed);
        assert.equal(replay.status, 409);
      }
      assert.equal(mockJobs.length, 1);
      assert.deepEqual(enqueuedIds, []);
      assert.equal(outboxEvents.length, 1);
    });

    test('scopes identical keys independently to each authenticated user', async () => {
      const input = { type: 'report', payload: { month: 'October' } };
      const first = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA)
        .set('Idempotency-Key', 'per-user-key').send(input);
      const otherUser = await request(app).post('/api/v1/jobs').set('Cookie', authCookieB)
        .set('Idempotency-Key', 'per-user-key').send(input);
      assert.equal(first.status, 201);
      assert.equal(otherUser.status, 201);
      assert.notEqual(first.body.job.id, otherUser.body.job.id);
      assert.equal(otherUser.body.job.userId, userB.id);
      assert.equal(mockJobs.length, 2);
      assert.equal(enqueuedIds.length, 0);
      assert.equal(outboxEvents.length, 2);
    });

    test('rejects empty and overlong idempotency keys', async () => {
      const empty = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA)
        .set('Idempotency-Key', '   ').send({ type: 'report' });
      const tooLong = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA)
        .set('Idempotency-Key', 'k'.repeat(256)).send({ type: 'report' });
      assert.equal(empty.status, 400);
      assert.equal(tooLong.status, 400);
      assert.equal(mockJobs.length, 0);
      assert.deepEqual(enqueuedIds, []);
    });

    test('derives ownership from the authenticated session instead of the body', async () => {
      const res = await request(app)
        .post('/api/v1/jobs')
        .set('Cookie', authCookieA)
        .send({ type: 'email', user_id: userB.id });
      assert.equal(res.status, 201);
      assert.equal(res.body.job.userId, userA.id);
    });

    test('ignores user-supplied job IDs and status', async () => {
      const res = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA).send({
        id: 'b0000000-0000-4000-8000-000000000001', type: 'report', status: 'completed'
      });
      assert.equal(res.status, 201);
      assert.notEqual(res.body.job.id, 'b0000000-0000-4000-8000-000000000001');
      assert.equal(res.body.job.status, 'waiting');
    });

    test('rejects job types without a demo handler', async () => {
      const res = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA).send({ type: 'email:send' });
      assert.equal(res.status, 400);
      assert.match(res.body.error, /Unsupported job type/);
    });

    test('commits the job and outbox independently of immediate Redis availability', async () => {
      queueService.enqueue = async () => { throw new Error('Redis unavailable'); };
      const res = await request(app).post('/api/v1/jobs').set('Cookie', authCookieA).send({ type: 'email' });
      assert.equal(res.status, 201);
      assert.equal(res.body.job.status, 'waiting');
      assert.equal(mockJobs.length, 1);
      assert.equal(outboxEvents.length, 1);
    });
  });

  describe('GET /api/v1/jobs (List & Filter Jobs)', () => {
    beforeEach(async () => {
      // Create jobs for User A
      mockJobs.push(
        {
          id: '10000000-0000-4000-8000-000000000001',
          user_id: userA.id,
          type: 'job:a1',
          payload: {},
          status: 'waiting',
          priority: 1,
          attempts: 0,
          result: null,
          error: null,
          created_at: new Date(Date.now() - 3000),
          updated_at: new Date(),
          started_at: null,
          completed_at: null
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          user_id: userA.id,
          type: 'job:a2',
          payload: {},
          status: 'completed',
          priority: 2,
          attempts: 1,
          result: { ok: true },
          error: null,
          created_at: new Date(Date.now() - 2000),
          updated_at: new Date(),
          started_at: null,
          completed_at: null
        },
        {
          id: '10000000-0000-4000-8000-000000000003',
          user_id: userA.id,
          type: 'job:a3',
          payload: {},
          status: 'failed',
          priority: 3,
          attempts: 3,
          result: null,
          error: 'Connection timeout',
          created_at: new Date(Date.now() - 1000),
          updated_at: new Date(),
          started_at: null,
          completed_at: null
        }
      );

      // Create a job for User B
      mockJobs.push({
        id: '20000000-0000-4000-8000-000000000001',
        user_id: userB.id,
        type: 'job:b1',
        payload: {},
        status: 'waiting',
        priority: 1,
        attempts: 0,
        result: null,
        error: null,
        created_at: new Date(),
        updated_at: new Date(),
        started_at: null,
        completed_at: null
      });
    });

    test('returns only jobs belonging to the authenticated user', async () => {
      const resA = await request(app).get('/api/v1/jobs').set('Cookie', authCookieA);
      assert.equal(resA.status, 200);
      assert.equal(resA.body.jobs.length, 3);
      assert.equal(resA.body.pagination.total, 3);
      assert.ok(resA.body.jobs.every((j: { userId: string }) => j.userId === userA.id));

      const resB = await request(app).get('/api/v1/jobs').set('Cookie', authCookieB);
      assert.equal(resB.status, 200);
      assert.equal(resB.body.jobs.length, 1);
      assert.equal(resB.body.jobs[0].userId, userB.id);
    });

    test('supports pagination with limit and page parameters', async () => {
      const res = await request(app)
        .get('/api/v1/jobs?page=1&limit=2')
        .set('Cookie', authCookieA);
      assert.equal(res.status, 200);
      assert.equal(res.body.jobs.length, 2);
      assert.equal(res.body.pagination.total, 3);
      assert.equal(res.body.pagination.totalPages, 2);
    });

    test('filters jobs by status', async () => {
      const res = await request(app)
        .get('/api/v1/jobs?status=completed')
        .set('Cookie', authCookieA);
      assert.equal(res.status, 200);
      assert.equal(res.body.jobs.length, 1);
      assert.equal(res.body.jobs[0].status, 'completed');
    });

    test('returns 400 for invalid status filter', async () => {
      const res = await request(app)
        .get('/api/v1/jobs?status=non-existent-status')
        .set('Cookie', authCookieA);
      assert.equal(res.status, 400);
      assert.match(res.body.error, /Invalid status filter/);
    });

    test('rejects invalid pagination values instead of silently coercing them', async () => {
      const res = await request(app)
        .get('/api/v1/jobs?page=1abc&limit=101')
        .set('Cookie', authCookieA);
      assert.equal(res.status, 400);
      assert.match(res.body.error, /page must be a positive integer/);
    });
  });

  describe('GET /api/v1/jobs/:id (Job Details & Cross-User Access)', () => {
    const jobAId = '10000000-0000-4000-8000-000000000001';
    const jobBId = '20000000-0000-4000-8000-000000000001';

    beforeEach(() => {
      mockJobs.push(
        {
          id: jobAId,
          user_id: userA.id,
          type: 'webhook:call',
          payload: { url: 'https://example.com/webhook' },
          status: 'waiting',
          priority: 1,
          attempts: 0,
          result: null,
          error: null,
          created_at: new Date(),
          updated_at: new Date(),
          started_at: null,
          completed_at: null
        },
        {
          id: jobBId,
          user_id: userB.id,
          type: 'sync:crm',
          payload: {},
          status: 'waiting',
          priority: 1,
          attempts: 0,
          result: null,
          error: null,
          created_at: new Date(),
          updated_at: new Date(),
          started_at: null,
          completed_at: null
        }
      );
    });

    test('returns job details when requested by owner', async () => {
      const res = await request(app)
        .get(`/api/v1/jobs/${jobAId}`)
        .set('Cookie', authCookieA);
      assert.equal(res.status, 200);
      assert.equal(res.body.job.id, jobAId);
      assert.equal(res.body.job.type, 'webhook:call');
    });

    test('blocks cross-user access with 404 (User A cannot view User B job)', async () => {
      const res = await request(app)
        .get(`/api/v1/jobs/${jobBId}`)
        .set('Cookie', authCookieA);
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Job not found');
    });

    test('returns 404 for non-existent job ID', async () => {
      const res = await request(app)
        .get('/api/v1/jobs/99999999-9999-4999-8999-999999999999')
        .set('Cookie', authCookieA);
      assert.equal(res.status, 404);
    });

    test('rejects malformed job IDs', async () => {
      const res = await request(app).get('/api/v1/jobs/not-a-uuid').set('Cookie', authCookieA);
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'Invalid job ID');
    });
  });

  describe('POST /api/v1/jobs/:id/retry', () => {
    const failedJobId = '10000000-0000-4000-8000-000000000099';

    beforeEach(() => {
      mockJobs.push({
        id: failedJobId, user_id: userA.id, type: 'report', payload: {}, status: 'failed', priority: 1,
        attempts: 3, result: null, error: 'Temporary failure', created_at: new Date(), updated_at: new Date(),
        started_at: new Date(), completed_at: new Date()
      });
    });

    test('retries an owned failed job once and preserves its PostgreSQL ID', async () => {
      const res = await request(app).post(`/api/v1/jobs/${failedJobId}/retry`).set('Cookie', authCookieA);
      assert.equal(res.status, 202);
      assert.equal(res.body.job.id, failedJobId);
      assert.equal(res.body.job.status, 'waiting');
      assert.equal(mockJobs[0].attempts, 3);
      assert.deepEqual(retriedIds, [failedJobId]);
    });

    test('does not allow another user to retry a failed job', async () => {
      const res = await request(app).post(`/api/v1/jobs/${failedJobId}/retry`).set('Cookie', authCookieB);
      assert.equal(res.status, 404);
      assert.equal(mockJobs[0].status, 'failed');
      assert.deepEqual(retriedIds, []);
    });

    test('rejects non-failed jobs and restores the failed state when Redis retry enqueue fails', async () => {
      const waitingId = '10000000-0000-4000-8000-000000000098';
      mockJobs.push({ ...mockJobs[0], id: waitingId, status: 'waiting', error: null, completed_at: null });
      const conflict = await request(app).post(`/api/v1/jobs/${waitingId}/retry`).set('Cookie', authCookieA);
      assert.equal(conflict.status, 409);

      queueService.retryFailed = async () => { throw new Error('Redis unavailable'); };
      const failure = await request(app).post(`/api/v1/jobs/${failedJobId}/retry`).set('Cookie', authCookieA);
      assert.equal(failure.status, 503);
      assert.equal(mockJobs[0].status, 'failed');
      assert.match(mockJobs[0].error ?? '', /Redis unavailable/);
    });

    test('concurrent retries reserve and enqueue a failed job only once', async () => {
      const results = await Promise.all([
        request(app).post(`/api/v1/jobs/${failedJobId}/retry`).set('Cookie', authCookieA),
        request(app).post(`/api/v1/jobs/${failedJobId}/retry`).set('Cookie', authCookieA)
      ]);
      assert.deepEqual(results.map((result) => result.status).sort(), [202, 409]);
      assert.deepEqual(retriedIds, [failedJobId]);
    });
  });

  describe('DELETE /api/v1/jobs/:id (Safe Deletion)', () => {
    const waitingJobId = '10000000-0000-4000-8000-000000000001';
    const activeJobId = '10000000-0000-4000-8000-000000000002';
    const otherUserJobId = '20000000-0000-4000-8000-000000000001';

    beforeEach(() => {
      mockJobs.push(
        {
          id: waitingJobId,
          user_id: userA.id,
          type: 'email:send',
          payload: {},
          status: 'waiting',
          priority: 1,
          attempts: 0,
          result: null,
          error: null,
          created_at: new Date(),
          updated_at: new Date(),
          started_at: null,
          completed_at: null
        },
        {
          id: activeJobId,
          user_id: userA.id,
          type: 'transcode:video',
          payload: {},
          status: 'active',
          priority: 2,
          attempts: 1,
          result: null,
          error: null,
          created_at: new Date(),
          updated_at: new Date(),
          started_at: new Date(),
          completed_at: null
        },
        {
          id: otherUserJobId,
          user_id: userB.id,
          type: 'backup:db',
          payload: {},
          status: 'waiting',
          priority: 1,
          attempts: 0,
          result: null,
          error: null,
          created_at: new Date(),
          updated_at: new Date(),
          started_at: null,
          completed_at: null
        }
      );
    });

    test('prevents deleting an active running job with 409', async () => {
      const res = await request(app)
        .delete(`/api/v1/jobs/${activeJobId}`)
        .set('Cookie', authCookieA);
      assert.equal(res.status, 409);
      assert.match(res.body.error, /Cannot delete an active job/);
    });

    test('deletes a waiting or completed job successfully', async () => {
      const res = await request(app)
        .delete(`/api/v1/jobs/${waitingJobId}`)
        .set('Cookie', authCookieA);
      assert.equal(res.status, 200);
      assert.equal(res.body.message, 'Job deleted successfully');

      // Verify job is no longer listed
      const checkRes = await request(app)
        .get(`/api/v1/jobs/${waitingJobId}`)
        .set('Cookie', authCookieA);
      assert.equal(checkRes.status, 404);
    });

    test('blocks cross-user deletion attempt with 404 (User A cannot delete User B job)', async () => {
      const res = await request(app)
        .delete(`/api/v1/jobs/${otherUserJobId}`)
        .set('Cookie', authCookieA);
      assert.equal(res.status, 404);
      assert.equal(res.body.error, 'Job not found');
    });
  });

  describe('GET /api/v1/jobs/stats (Dashboard Metrics)', () => {
    test('returns aggregated job counts for authenticated user', async () => {
      mockJobs.push(
        {
          id: '10000000-0000-4000-8000-000000000001',
          user_id: userA.id,
          type: 'a',
          payload: {},
          status: 'waiting',
          priority: 1,
          attempts: 0,
          result: null,
          error: null,
          created_at: new Date(),
          updated_at: new Date(),
          started_at: null,
          completed_at: null
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          user_id: userA.id,
          type: 'b',
          payload: {},
          status: 'completed',
          priority: 1,
          attempts: 1,
          result: null,
          error: null,
          created_at: new Date(),
          updated_at: new Date(),
          started_at: null,
          completed_at: null
        }
      );

      const res = await request(app).get('/api/v1/jobs/stats').set('Cookie', authCookieA);
      assert.equal(res.status, 200);
      assert.equal(res.body.total, 2);
      assert.equal(res.body.waiting, 1);
      assert.equal(res.body.completed, 1);
      assert.equal(res.body.failed, 0);
    });
  });
});
