import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainWithGrace, onceAsync } from '../src/lifecycle';
import { submissionRateLimitKey } from '../src/queue';
import { createSubmissionRateLimiter } from '../src/middleware/submissionControls';
import { writeLog } from '../src/logger';
import type { Request, Response, NextFunction } from 'express';

test('drain completes without forcing and repeated shutdown calls share cleanup', async () => {
  let calls = 0;
  const cleanup = onceAsync(async () => { calls += 1; });
  await Promise.all([cleanup(), cleanup()]);
  assert.equal(calls, 1);
  const outcome = await drainWithGrace('api', 100, async () => undefined, async () => assert.fail('unexpected force'));
  assert.deepEqual(outcome, { forced: false });
});

test('shutdown grace expiry takes the deterministic force path', async () => {
  let forced = false;
  const outcome = await drainWithGrace('worker', 0, () => new Promise<void>(() => undefined), async () => { forced = true; });
  assert.deepEqual(outcome, { forced: true });
  assert.equal(forced, true);
});

test('job submission rate limiting returns standard headers and isolates user/window keys', async () => {
  const userWindows = new Map<string, number>();
  const limiter = createSubmissionRateLimiter(async (userId) => {
    const key = submissionRateLimitKey(userId, Date.now(), 60000);
    const count = (userWindows.get(key) ?? 0) + 1;
    userWindows.set(key, count);
    return { allowed: count <= 1, limit: 1, remaining: Math.max(0, 1 - count), resetSeconds: 60 };
  }, async () => undefined);
  const invoke = async (userId: string) => {
    const headers: Record<string, string> = {};
    let statusCode = 200;
    let body: unknown;
    let nextCalled = false;
    const req = { user: { id: userId } } as unknown as Request;
    const res = {
      setHeader: (key: string, value: string) => { headers[key] = value; },
      status: (value: number) => { statusCode = value; return res; },
      json: (value: unknown) => { body = value; return res; }
    } as unknown as Response;
    await limiter(req, res, (() => { nextCalled = true; }) as NextFunction);
    return { headers, statusCode, body, nextCalled };
  };
  const allowed = await invoke('user-a');
  const rejected = await invoke('user-a');
  const otherUser = await invoke('user-b');
  assert.equal(allowed.nextCalled, true);
  assert.equal(allowed.headers['RateLimit-Limit'], '1');
  assert.equal(rejected.statusCode, 429);
  assert.equal((rejected.body as { code: string }).code, 'RATE_LIMITED');
  assert.equal(otherUser.nextCalled, true);
  assert.notEqual(submissionRateLimitKey('user-a', 59999, 60000), submissionRateLimitKey('user-a', 60000, 60000));
});

test('rate limit keys and structured rejection logs do not expose user IDs or credentials', () => {
  const key = submissionRateLimitKey('private-user-id', 1234, 60000);
  assert.equal(key.includes('private-user-id'), false);
  const originalLog = console.log;
  const originalWarn = console.warn;
  let output = '';
  console.log = (value?: unknown) => { output = String(value); };
  console.warn = (value?: unknown) => { output = String(value); };
  try {
    writeLog('api', 'warn', 'safe_test', { Authorization: 'Bearer jwt-secret', cookie: 'session-secret', REDIS_URL: 'redis://user:password@host', userId: 'user-ok' });
  } finally { console.log = originalLog; console.warn = originalWarn; }
  assert.equal(output.includes('jwt-secret'), false);
  assert.equal(output.includes('session-secret'), false);
  assert.equal(output.includes('password'), false);
  assert.equal(output.includes('user-ok'), true);
});
