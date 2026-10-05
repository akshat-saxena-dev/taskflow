import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWorkerConcurrency } from '../scripts/benchmark-metrics.mjs';

test('benchmark reads worker concurrency from the live worker heartbeat', () => {
  assert.equal(getWorkerConcurrency({ worker: { alive: true, concurrency: 10 } }), 10);
});

test('benchmark refuses to guess worker concurrency when heartbeat data is missing', () => {
  assert.throws(() => getWorkerConcurrency({ worker: { alive: false } }), /heartbeat is offline/);
  assert.throws(() => getWorkerConcurrency({ worker: { alive: true } }), /valid concurrency/);
});
