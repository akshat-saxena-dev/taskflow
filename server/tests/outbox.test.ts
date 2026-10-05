import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as dbModule from '../src/db';
import { queueService } from '../src/queue';
import { dispatchOutboxOnce } from '../src/outbox/dispatcher';

const event = { id: '1', job_id: 'a0000000-0000-4000-8000-000000000001', event_type: 'job.dispatch', attempts: 0 };
let status: 'pending' | 'processing' | 'failed' | 'processed' = 'pending';
let attempts = 0;
let failures = 0;
let staleProcessing = false;
let enqueued: string[] = [];
let lastClaimSql = '';

(dbModule.db as unknown as { query: typeof dbModule.db.query }).query = (async (text: string) => {
  const query = text.trim();
  if (query.startsWith('WITH candidates AS')) {
    lastClaimSql = query;
    if (status === 'pending' || status === 'failed' || (status === 'processing' && staleProcessing)) {
      status = 'processing';
      attempts += 1;
      staleProcessing = false;
      return { rows: [{ ...event, attempts }], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] };
    }
    return { rows: [], command: 'UPDATE', rowCount: 0, oid: 0, fields: [] };
  }
  if (query.includes("SET status = 'processed'")) {
    status = 'processed';
    return { rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] };
  }
  if (query.includes("SET status = 'failed'")) {
    status = 'failed';
    failures += 1;
    return { rows: [], command: 'UPDATE', rowCount: 1, oid: 0, fields: [] };
  }
  throw new Error(`Unexpected outbox test query: ${query}`);
}) as unknown as typeof dbModule.db.query;

beforeEach(() => {
  status = 'pending'; attempts = 0; failures = 0; staleProcessing = false; enqueued = [];
  lastClaimSql = '';
  queueService.enqueue = async (jobId) => { enqueued.push(jobId); };
});

test('successful queue dispatch marks its outbox event processed and does not enqueue it twice', async () => {
  const result = await dispatchOutboxOnce();
  assert.deepEqual(result, { claimed: 1, processed: 1, failed: 0 });
  assert.equal(status, 'processed');
  assert.deepEqual(enqueued, [event.job_id]);
  assert.equal((await dispatchOutboxOnce()).claimed, 0);
  assert.equal(enqueued.length, 1);
});

test('Redis failures keep the event retryable and a later dispatch succeeds', async () => {
  queueService.enqueue = async () => { throw new Error('Redis unavailable'); };
  const failed = await dispatchOutboxOnce();
  assert.deepEqual(failed, { claimed: 1, processed: 0, failed: 1 });
  assert.equal(status, 'failed');
  assert.equal(failures, 1);
  queueService.enqueue = async (jobId) => { enqueued.push(jobId); };
  const retried = await dispatchOutboxOnce();
  assert.deepEqual(retried, { claimed: 1, processed: 1, failed: 0 });
  assert.equal(status, 'processed');
  assert.equal(attempts, 2);
  assert.match(lastClaimSql, /status = 'processing'.*updated_at <= CURRENT_TIMESTAMP/s);
});

test('a processing event can be claimed again after its claim becomes stale', async () => {
  status = 'processing';
  attempts = 1;
  staleProcessing = true;
  const result = await dispatchOutboxOnce();
  assert.equal(result.claimed, 1);
  assert.equal(status, 'processed');
  assert.equal(attempts, 2);
});
