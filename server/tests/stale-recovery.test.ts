import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as dbModule from '../src/db';
import { config } from '../src/config';
import { queueService, StaleQueueJob } from '../src/queue';
import { recoverStaleJobsOnce } from '../src/recovery/staleJobs';

const id = 'a0000000-0000-4000-8000-000000000001';
let row: { id: string; attempts: number; attempts_in_cycle: number; error: string | null; started_at: Date; status: string };
let locked = false;
let reconcile: (jobId: string) => Promise<StaleQueueJob>;
let requeued: string[];
let metrics: string[];
let detected = new Set<string>();
let lastUpdateSql = '';
let lastUpdateParams: unknown[] = [];

const installTransactionMock = () => {
  (dbModule.db as unknown as { transaction: typeof dbModule.db.transaction }).transaction = (async (callback) => {
    const tx = { query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM jobs') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        const staleBefore = params[0] as Date;
        if (locked || row.status !== 'active' || row.started_at > staleBefore) return { rows: [], rowCount: 0 };
        locked = true;
        return { rows: [{ id: row.id, attempts: row.attempts, attempts_in_cycle: row.attempts_in_cycle, error: row.error, started_at: row.started_at }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE jobs')) {
        lastUpdateSql = sql;
        lastUpdateParams = params;
        row.status = String(params[1]);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      throw new Error(`Unexpected stale recovery SQL: ${sql}`);
    } };
    try { return await callback(tx as never); }
    finally { locked = false; }
  }) as typeof dbModule.db.transaction;
};

beforeEach(() => {
  row = { id, attempts: 1, attempts_in_cycle: 1, error: 'worker connection lost', started_at: new Date('2026-01-01T00:00:00Z'), status: 'active' };
  locked = false;
  requeued = [];
  metrics = [];
  detected = new Set();
  lastUpdateSql = '';
  lastUpdateParams = [];
  config.jobStaleTimeoutMs = 600000;
  config.jobAttempts = 3;
  reconcile = async () => ({ state: 'missing' });
  installTransactionMock();
  queueService.reconcileStaleJob = async (jobId) => reconcile(jobId);
  queueService.requeueMissing = async (jobId) => { requeued.push(jobId); };
  queueService.addRecoveryMetric = async (name) => { metrics.push(name); };
  queueService.markStaleDetected = async (jobId, startedAt) => {
    const key = `${jobId}:${startedAt.getTime()}`;
    if (detected.has(key)) return false;
    detected.add(key);
    return true;
  };
  queueService.markStaleDecision = async () => true;
});

test('an active PostgreSQL job below the timeout is not recovered', async () => {
  row.started_at = new Date('2026-01-01T00:09:30Z');
  const result = await recoverStaleJobsOnce(new Date('2026-01-01T00:10:00Z'));
  assert.deepEqual(result, { detected: 0, recovered: 0, failures: 0 });
  assert.equal(row.status, 'active');
  assert.deepEqual(requeued, []);
});

test('a stale active job with no BullMQ record is requeued under its existing ID', async () => {
  const result = await recoverStaleJobsOnce(new Date('2026-01-01T00:20:00Z'));
  assert.equal(result.recovered, 1);
  assert.equal(row.status, 'waiting');
  assert.deepEqual(requeued, [id]);
  assert.equal(row.attempts, 1);
});

test('a stale PostgreSQL row with a valid BullMQ lock is protected as long-running work', async () => {
  reconcile = async () => ({ state: 'active', lockValid: true, attemptsMade: 1, maxAttempts: 3 });
  const result = await recoverStaleJobsOnce(new Date('2026-01-01T00:20:00Z'));
  assert.equal(result.detected, 1);
  assert.equal(result.recovered, 0);
  assert.equal(row.status, 'active');
  assert.deepEqual(requeued, []);
});

test('an expired BullMQ lock is advanced through BullMQ stalled semantics and reconciled', async () => {
  const states: StaleQueueJob[] = [
    { state: 'active', lockValid: false, stalledCheck: 'pending' },
    { state: 'waiting', lockValid: false, stalledCheck: 'moved' }
  ];
  reconcile = async () => states.shift()!;
  const first = await recoverStaleJobsOnce(new Date('2026-01-01T00:20:00Z'));
  assert.equal(first.recovered, 0);
  assert.equal(row.status, 'active');
  const second = await recoverStaleJobsOnce(new Date('2026-01-01T00:20:01Z'));
  assert.equal(second.recovered, 1);
  assert.equal(row.status, 'waiting');
  assert.deepEqual(requeued, []); // BullMQ reused the existing job ID; no second queue job was added.
});

test('concurrent recovery passes cannot recover the same locked job twice', async () => {
  let inspected = 0;
  reconcile = async () => { inspected += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { state: 'missing' }; };
  const results = await Promise.all([
    recoverStaleJobsOnce(new Date('2026-01-01T00:20:00Z')),
    recoverStaleJobsOnce(new Date('2026-01-01T00:20:00Z'))
  ]);
  assert.equal(inspected, 1);
  assert.equal(results.reduce((sum, result) => sum + result.recovered, 0), 1);
  assert.deepEqual(requeued, [id]);
});

test('recovery marks an exhausted stale job terminally failed without resetting attempts', async () => {
  row.attempts = 6;
  row.attempts_in_cycle = config.jobAttempts;
  const result = await recoverStaleJobsOnce(new Date('2026-01-01T00:20:00Z'));
  assert.equal(result.recovered, 1);
  assert.equal(row.status, 'failed');
  assert.equal(row.attempts, 6);
  assert.deepEqual(requeued, []);
});

test('BullMQ stalled retry exhaustion is copied to PostgreSQL as terminal failure', async () => {
  reconcile = async () => ({ state: 'waiting', lockValid: false, stalledCheck: 'moved', stalledCount: config.workerMaxStalledCount + 1 });
  const result = await recoverStaleJobsOnce(new Date('2026-01-01T00:20:00Z'));
  assert.equal(result.recovered, 1);
  assert.equal(row.status, 'failed');
  assert.deepEqual(requeued, []);
});

test('terminal recovery update explicitly types the repeated status bind parameter', async () => {
  reconcile = async () => ({ state: 'failed', error: 'job stalled more than allowable limit' });
  const result = await recoverStaleJobsOnce(new Date('2026-01-01T00:20:00Z'));
  assert.equal(result.recovered, 1);
  assert.match(lastUpdateSql, /SET status = \$2::varchar, error = CASE WHEN \$2::varchar = 'failed'/);
  assert.equal(lastUpdateParams[1], 'failed');
  assert.equal(row.status, 'failed');
});

test('a queue inspection failure is recorded and leaves the PostgreSQL job active', async () => {
  reconcile = async () => { throw new Error('Redis unavailable'); };
  const result = await recoverStaleJobsOnce(new Date('2026-01-01T00:20:00Z'));
  assert.equal(result.failures, 1);
  assert.equal(row.status, 'active');
  assert.deepEqual(metrics, ['detected', 'failures']);
});
