import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import IORedis from 'ioredis';
import { waitForRedisReady } from '../src/queue/redisReady';

test('waitForRedisReady waits for a connecting Redis client before allowing commands', async () => {
  const events = new EventEmitter();
  let status = 'connecting';
  const client = {
    get status() { return status; },
    once: events.once.bind(events),
    removeListener: events.removeListener.bind(events),
    connect: async () => undefined
  } as unknown as IORedis;

  const ready = waitForRedisReady(client, 1000);
  setImmediate(() => {
    status = 'ready';
    events.emit('ready');
  });
  await ready;
});

test('waitForRedisReady rejects promptly when Redis connection fails', async () => {
  const events = new EventEmitter();
  const client = {
    status: 'connecting',
    once: events.once.bind(events),
    removeListener: events.removeListener.bind(events)
  } as unknown as IORedis;
  const ready = waitForRedisReady(client, 1000);
  setImmediate(() => events.emit('error', new Error('unreachable')));
  await assert.rejects(ready, /unreachable/);
});
