import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app';
import { config } from '../src/config';
import { queueObservability } from '../src/queue';
import { db } from '../src/db';
import jwt from 'jsonwebtoken';

test('health is an inexpensive liveness endpoint and returns a request ID', async () => {
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
});

test('request ID accepts a safe caller value and echoes it', async () => {
  const response = await request(app).get('/health').set('X-Request-ID', 'test-request.123');
  assert.equal(response.headers['x-request-id'], 'test-request.123');
});

test('request logging does not echo JWT-shaped request IDs', async () => {
  const tokenLike = 'header.payload.signature';
  const response = await request(app).get('/health').set('X-Request-ID', tokenLike);
  assert.notEqual(response.headers['x-request-id'], tokenLike);
  assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/i);
});

test('metrics requires authentication', async () => {
  const response = await request(app).get('/api/v1/metrics');
  assert.equal(response.status, 401);
  assert.equal(response.headers['x-request-id'] !== undefined, true);
});

test('metrics returns aggregate pressure without job payload or credentials', async () => {
  const methods = {
    counts: queueObservability.counts, pressure: queueObservability.pressure,
    workerStatus: queueObservability.workerStatus, dispatcherAlive: queueObservability.dispatcherAlive,
    recoveryMetrics: queueObservability.recoveryMetrics, submissionRejections: queueObservability.submissionRejections
  };
  const originalQuery = db.query;
  queueObservability.counts = async () => ({ waiting: 2, active: 1, delayed: 0, completed: 4, failed: 0 });
  queueObservability.pressure = async () => ({ waiting: 2, pending: 3, maxWaiting: 10000, maxPending: 20000, overloaded: false });
  queueObservability.workerStatus = async () => ({ processed: 5, active: 1 });
  queueObservability.dispatcherAlive = async () => true;
  queueObservability.recoveryMetrics = async () => ({ detected: 0, recovered: 0, failures: 0 });
  queueObservability.submissionRejections = async () => ({ rateLimited: 1, backpressure: 2 });
  (db as unknown as { query: typeof db.query }).query = (async (sql: string) => {
    if (sql.includes('FROM users')) return { rows: [{ id: 'metrics-user', name: 'Metrics', email: 'metrics@example.test' }] };
    return { rows: [{ pending: 1, processing: 0, failed: 0, processed: 0, attempts: 0, dispatch_failures: 0 }] };
  }) as typeof db.query;
  try {
    const token = jwt.sign({ id: 'metrics-user', name: 'Metrics', email: 'metrics@example.test' }, config.jwtSecret);
    const response = await request(app).get('/api/v1/metrics').set('Cookie', `token=${token}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.pressure.pending, 3);
    assert.equal(response.body.submissionRejections.rateLimited, 1);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes('payload'), false);
    assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes('REDIS_URL'), false);
  } finally {
    (db as unknown as { query: typeof db.query }).query = originalQuery;
    Object.assign(queueObservability, methods);
  }
});

test('readiness reports missing dependencies without exposing connection details', async () => {
  const originalDatabaseUrl = config.databaseUrl;
  const originalRedisReady = queueObservability.redisReady;
  const originalWorkerAlive = queueObservability.workerAlive;
  config.databaseUrl = '';
  queueObservability.redisReady = async () => false;
  queueObservability.workerAlive = async () => false;
  try {
    const response = await request(app).get('/ready');
    assert.equal(response.status, 503);
    assert.equal(response.body.status, 'not_ready');
    assert.equal(JSON.stringify(response.body).includes('DATABASE_URL'), false);
    assert.equal(JSON.stringify(response.body).includes('redis://'), false);
  } finally {
    config.databaseUrl = originalDatabaseUrl;
    queueObservability.redisReady = originalRedisReady;
    queueObservability.workerAlive = originalWorkerAlive;
  }
});
