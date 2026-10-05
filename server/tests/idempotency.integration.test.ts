import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import path from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../src/app';
import { config } from '../src/config';
import { closeDb } from '../src/db';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL unique index prevents concurrent duplicate job creation', { skip: testDatabaseUrl ? false : 'TEST_DATABASE_URL is not configured; PostgreSQL concurrency was not verified.' }, async () => {
  const pool = new Pool({
    connectionString: testDatabaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 10
  });
  let userId: string | undefined;
  const idempotencyKey = `concurrent-${randomUUID()}`;

  try {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      ['Idempotency Integration Test', `taskflow-${randomUUID()}@example.test`, 'test-only-hash']
    );
    userId = user.rows[0].id;

    const inserts = await Promise.all(Array.from({ length: 8 }, () => pool.query<{ id: string }>(
      `INSERT INTO jobs (user_id, type, payload, priority, idempotency_key)
       VALUES ($1, 'report', '{}'::jsonb, 1, $2)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id`, [userId, idempotencyKey]
    )));

    assert.equal(inserts.reduce((count, result) => count + (result.rowCount ?? 0), 0), 1);
    const count = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM jobs WHERE user_id = $1 AND idempotency_key = $2',
      [userId, idempotencyKey]
    );
    assert.equal(count.rows[0].count, '1');
  } finally {
    if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.end();
  }
});

test('concurrent HTTP idempotency requests enqueue once and distinct keys create every job', { skip: testDatabaseUrl ? false : 'TEST_DATABASE_URL is not configured; PostgreSQL concurrency was not verified.' }, async () => {
  const pool = new Pool({ connectionString: testDatabaseUrl, ssl: { rejectUnauthorized: false }, max: 10 });
  config.databaseUrl = testDatabaseUrl!;
  let userId: string | undefined;
  try {
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
      ['Load Test Integration', `taskflow-${randomUUID()}@example.test`, 'test-only-hash']
    );
    userId = user.rows[0].id;
    const token = jwt.sign({ id: userId, name: 'Load Test Integration', email: 'integration@example.test' }, config.jwtSecret);
    const cookie = `token=${token}`;
    const sameKey = `concurrent-http-${randomUUID()}`;
    const duplicates = await Promise.all(Array.from({ length: 20 }, () => request(app)
      .post('/api/v1/jobs').set('Cookie', cookie).set('Idempotency-Key', sameKey)
      .send({ type: 'report', priority: 'normal', payload: { benchmark: 'same' } })));
    assert.equal(duplicates.filter((response) => response.status === 201).length, 1);
    assert.equal(duplicates.filter((response) => response.status === 200).length, 19);
    assert.equal(new Set(duplicates.map((response) => response.body.job.id)).size, 1);
    const sameCount = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM jobs WHERE user_id = $1 AND idempotency_key = $2', [userId, sameKey]
    );
    assert.equal(sameCount.rows[0].count, '1');
    const sameOutboxCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM outbox_events WHERE job_id = $1 AND event_type = 'job.dispatch'`,
      [duplicates[0].body.job.id]
    );
    assert.equal(sameOutboxCount.rows[0].count, '1');

    const distinctCount = 20;
    const different = await Promise.all(Array.from({ length: distinctCount }, (_, index) => request(app)
      .post('/api/v1/jobs').set('Cookie', cookie).set('Idempotency-Key', `distinct-${randomUUID()}`)
      .send({ type: 'report', priority: 'normal', payload: { sequence: index } })));
    assert.ok(different.every((response) => response.status === 201));
    const differentIds = different.map((response) => response.body.job.id as string);
    assert.equal(new Set(differentIds).size, distinctCount);
    const distinctOutboxCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM outbox_events WHERE job_id = ANY($1::uuid[]) AND event_type = 'job.dispatch'`,
      [differentIds]
    );
    assert.equal(distinctOutboxCount.rows[0].count, String(distinctCount));
    const createdCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM jobs WHERE user_id = $1 AND
       (idempotency_key = $2 OR idempotency_key LIKE 'distinct-%')`, [userId, sameKey]
    );
    assert.equal(createdCount.rows[0].count, String(1 + distinctCount));
  } finally {
    if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await closeDb();
    await pool.end();
  }
});
