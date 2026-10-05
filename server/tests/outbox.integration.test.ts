import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';
import { config } from '../src/config';
import { closeDb } from '../src/db';
import { claimOutboxBatch } from '../src/outbox/dispatcher';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test('multiple PostgreSQL dispatchers cannot claim the same outbox event', { skip: testDatabaseUrl ? false : 'TEST_DATABASE_URL is not configured; PostgreSQL outbox claims were not verified.' }, async () => {
  const pool = new Pool({ connectionString: testDatabaseUrl, ssl: { rejectUnauthorized: false }, max: 10 });
  const originalDatabaseUrl = config.databaseUrl;
  const originalBatchSize = config.dispatcherBatchSize;
  let userId: string | undefined;
  config.databaseUrl = testDatabaseUrl!;
  config.dispatcherBatchSize = 1;
  try {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Outbox Integration Test', `outbox-${randomUUID()}@example.test`, 'test-only-hash']
    );
    userId = user.rows[0].id;
    const job = await pool.query<{ id: string }>(
      `INSERT INTO jobs (user_id, type, payload, priority) VALUES ($1, 'report', '{}'::jsonb, 1) RETURNING id`, [userId]
    );
    await pool.query(`INSERT INTO outbox_events (job_id, event_type) VALUES ($1, 'job.dispatch')`, [job.rows[0].id]);
    const [first, second] = await Promise.all([claimOutboxBatch(job.rows[0].id), claimOutboxBatch(job.rows[0].id)]);
    assert.equal(first.length + second.length, 1);
    const state = await pool.query<{ status: string }>('SELECT status FROM outbox_events WHERE job_id = $1', [job.rows[0].id]);
    assert.equal(state.rows[0].status, 'processing');
  } finally {
    if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    config.databaseUrl = originalDatabaseUrl;
    config.dispatcherBatchSize = originalBatchSize;
    await closeDb();
    await pool.end();
  }
});
