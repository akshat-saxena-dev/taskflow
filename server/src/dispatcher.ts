import IORedis from 'ioredis';
import { randomUUID } from 'crypto';
import { config } from './config';
import { dispatchOutboxOnce } from './outbox/dispatcher';
import { writeLog } from './logger';
import { closeDb } from './db';
import { closeQueue } from './queue';
import { waitForRedisReady } from './queue/redisReady';
import { recoverStaleJobsOnce } from './recovery/staleJobs';
import { drainWithGrace, logShutdownCompleted, onceAsync } from './lifecycle';

const HEARTBEATS_KEY = 'taskflow:dispatcher:heartbeats';
const HEARTBEAT_TTL_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 10000;

export const startDispatcher = (): { close: () => Promise<void> } => {
  if (!config.redisUrl) throw new Error('REDIS_URL environment variable is missing.');
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true, connectTimeout: 5000 });
  const dispatcherId = randomUUID();
  let stopped = false;
  let wakeLoop: (() => void) | undefined;
  let heartbeatInFlight: Promise<void> = Promise.resolve();
  connection.on('error', (error) => writeLog('dispatcher', 'error', 'redis_error', { error }));

  const heartbeat = async () => {
    if (stopped) return;
    try {
      await waitForRedisReady(connection);
      const now = Date.now();
      await connection.zremrangebyscore(HEARTBEATS_KEY, 0, now - HEARTBEAT_TTL_MS);
      await connection.zadd(HEARTBEATS_KEY, now, dispatcherId);
      await connection.expire(HEARTBEATS_KEY, 60);
    } catch (error) { writeLog('dispatcher', 'warn', 'heartbeat_update_failed', { error }); }
  };
  const runHeartbeat = () => { heartbeatInFlight = heartbeat(); };
  runHeartbeat();
  const heartbeatTimer = setInterval(runHeartbeat, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  const run = async () => {
    while (!stopped) {
      try {
        await recoverStaleJobsOnce();
        const result = await dispatchOutboxOnce();
        if (result.claimed > 0) writeLog('dispatcher', 'info', 'outbox_batch_finished', result);
      } catch (error) { writeLog('dispatcher', 'error', 'outbox_poll_failed', { error }); }
      if (!stopped) await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { wakeLoop = undefined; resolve(); }, config.dispatcherPollIntervalMs);
        wakeLoop = () => { clearTimeout(timer); wakeLoop = undefined; resolve(); };
      });
    }
  };
  const loop = run();
  writeLog('dispatcher', 'info', 'dispatcher_started', {
    dispatcherId, pollIntervalMs: config.dispatcherPollIntervalMs,
    batchSize: config.dispatcherBatchSize, claimTimeoutMs: config.outboxClaimTimeoutMs
  });

  const close = onceAsync(async () => {
      stopped = true;
      wakeLoop?.();
      clearInterval(heartbeatTimer);
      const result = await drainWithGrace('dispatcher', config.shutdownGracePeriodMs,
        async () => { await heartbeatInFlight; await loop; },
        async () => { connection.disconnect(); });
      if (!result.forced) await connection.zrem(HEARTBEATS_KEY, dispatcherId).catch((error) => writeLog('dispatcher', 'warn', 'shutdown_heartbeat_delete_failed', { error }));
      try { if (!result.forced) await connection.quit(); } catch { connection.disconnect(); }
      await Promise.allSettled([closeQueue(), closeDb()]);
      writeLog('dispatcher', 'info', 'dispatcher_stopped', { dispatcherId });
      logShutdownCompleted('dispatcher', result.forced);
      if (result.forced) process.exitCode = 1;
  });
  return { close };
};

if (require.main === module) {
  let dispatcher: ReturnType<typeof startDispatcher>;
  try { dispatcher = startDispatcher(); }
  catch (error: unknown) {
    writeLog('dispatcher', 'error', 'dispatcher_startup_failed', { error });
    process.exit(1);
  }
  const shutdown = onceAsync(async () => { await dispatcher.close(); });
  const onSignal = () => { void shutdown().then(() => { if (process.exitCode === 1) process.exit(1); }).catch((error) => { writeLog('dispatcher', 'error', 'shutdown_failed', { error }); process.exit(1); }); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}
