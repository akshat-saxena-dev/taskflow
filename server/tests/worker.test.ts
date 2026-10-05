import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as dbModule from '../src/db';
import { isDemoCrashHoldRequested, processJob } from '../src/worker';
import { defaultJobOptions } from '../src/queue';

const jobId = 'a0000000-0000-4000-8000-000000000001';
let record: { id: string; type: string; payload: Record<string, unknown> } | null = null;
let state: { status: string; attempts: number; result: Record<string, unknown> | null; error: string | null; completedAt: boolean; updatedAt: boolean };

(dbModule.db as unknown as { query: typeof dbModule.db.query }).query = (async (text: string, params: unknown[] = []) => {
  const query = text.trim();
  if (query.startsWith('SELECT id, type, payload FROM jobs')) {
    return { rows: record ? [record] : [], command: 'SELECT', rowCount: record ? 1 : 0, oid: 0, fields: [] };
  }
  if (query.startsWith("UPDATE jobs SET status = 'active'")) {
    state.status = 'active';
    state.attempts += 1;
    state.updatedAt = query.includes('updated_at = CURRENT_TIMESTAMP');
    return { rows: [{ id: jobId }], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] };
  }
  if (query.startsWith("UPDATE jobs SET status = 'completed'")) {
    state.status = 'completed';
    state.result = JSON.parse(String(params[1]));
    state.error = null;
    state.completedAt = true;
    state.updatedAt = query.includes('updated_at = CURRENT_TIMESTAMP');
    return { rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] };
  }
  if (query.startsWith("UPDATE jobs SET status = 'delayed'")) {
    state.status = 'delayed';
    state.error = String(params[1]);
    state.completedAt = false;
    state.updatedAt = query.includes('updated_at = CURRENT_TIMESTAMP');
    return { rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] };
  }
  if (query.startsWith("UPDATE jobs SET status = 'failed'")) {
    state.status = 'failed';
    state.error = String(params[1]);
    state.completedAt = state.status === 'failed';
    state.updatedAt = query.includes('updated_at = CURRENT_TIMESTAMP');
    return { rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] };
  }
  throw new Error(`Unexpected SQL: ${query}`);
}) as unknown as typeof dbModule.db.query;

const reset = (type: string) => {
  record = { id: jobId, type, payload: { records: [1, 2, 3] } };
  state = { status: 'waiting', attempts: 0, result: null, error: null, completedAt: false, updatedAt: false };
};

const bullJob = (attemptsMade: number) => ({ id: jobId, data: { jobId }, attemptsMade, opts: { attempts: 3 } }) as never;

test('new jobs use three attempts and exponential backoff by default', () => {
  const options = defaultJobOptions();
  assert.equal(options.attempts, 3);
  assert.equal(options.backoff.type, 'exponential');
  assert.ok(options.backoff.delay > 0);
});

test('demo crash hold requires the explicit enable flag and holds only the first attempt', () => {
  const payload = { demoCrashHoldFirstAttempt: true };
  assert.equal(isDemoCrashHoldRequested(payload, 1, false), false);
  assert.equal(isDemoCrashHoldRequested(payload, 2, true), false);
  assert.equal(isDemoCrashHoldRequested(payload, 1, true), true);
});

test('worker completes a supported demo job and persists result and attempt count', async () => {
  reset('data-processing');
  await processJob(bullJob(0));
  assert.equal(state.status, 'completed');
  assert.equal(state.updatedAt, true);
  assert.equal(state.attempts, 1);
  assert.deepEqual(state.result, { demo: true, message: 'Demo data processing completed.', recordsProcessed: 3 });
});

test('worker records a transient failure then succeeds on the next attempt', async () => {
  reset('report');
  record!.payload = { failuresBeforeSuccess: 1, simulatedError: 'Temporary failure' };
  await assert.rejects(processJob(bullJob(0)), /Temporary failure/);
  assert.equal(state.status, 'delayed');
  assert.equal(state.completedAt, false);
  assert.equal(state.updatedAt, true);
  assert.equal(state.error, 'Temporary failure');
  assert.equal(state.attempts, 1);
  await processJob(bullJob(1));
  assert.equal(state.status, 'completed');
  assert.equal(state.attempts, 2);
  assert.deepEqual(state.result, { demo: true, message: 'Demo report generated.', reportType: 'summary' });
});

test('worker marks a permanent error failed at the configured retry limit', async () => {
  reset('report');
  record!.payload = { simulateFailure: true, simulatedError: 'Permanent failure' };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(processJob(bullJob(attempt)), /Permanent failure/);
    if (attempt < 2) {
      assert.equal(state.status, 'delayed');
      assert.equal(state.completedAt, false);
    }
  }
  assert.equal(state.status, 'failed');
  assert.equal(state.attempts, 3);
  assert.equal(state.completedAt, true);
  assert.equal(state.updatedAt, true);
  assert.equal(state.error, 'Permanent failure');
});

test('worker ignores a PostgreSQL job deleted before processing starts', async () => {
  reset('email');
  record = null;
  await processJob(bullJob(0));
  assert.equal(state.status, 'waiting');
  assert.equal(state.attempts, 0);
});
