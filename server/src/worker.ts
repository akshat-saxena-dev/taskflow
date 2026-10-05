import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config';
import { closeDb, db } from './db';
import { QUEUE_NAME, QueueJobData } from './queue';
import { runDemoHandler } from './workers/handlers';
import { writeLog } from './logger';
import { waitForRedisReady } from './queue/redisReady';
import { drainWithGrace, logShutdownCompleted, onceAsync } from './lifecycle';

export const workerMetrics = { processed: 0, succeeded: 0, failed: 0, retries: 0, active: 0, totalDurationMs: 0 };

export const isDemoCrashHoldRequested = (payload: Record<string, unknown>, attemptsInCycle: number, enabled: boolean): boolean =>
  enabled && payload.demoCrashHoldFirstAttempt === true && attemptsInCycle === 1;

const holdForDemoCrash = async (payload: Record<string, unknown>, attemptsInCycle: number, jobId: string): Promise<void> => {
  if (!isDemoCrashHoldRequested(payload, attemptsInCycle, config.demoCrashHoldEnabled)) return;
  writeLog('worker', 'warn', 'demo_crash_hold_started', { jobId, attemptsInCycle });
  await new Promise<void>(() => undefined);
};

export const processJob = async (
  job: Pick<Job<QueueJobData>, 'id' | 'data' | 'attemptsMade' | 'opts'>
): Promise<void> => {
  const processingStarted = Date.now();
  const jobId = job.data.jobId;
  if (!job.id || job.id !== jobId) throw new Error('Queue job ID does not match its PostgreSQL job ID.');

  const found = await db.query<{ id: string; type: string; payload: Record<string, unknown> }>(
    'SELECT id, type, payload FROM jobs WHERE id = $1', [jobId]
  );
  const record = found.rows[0];
  if (!record) return; // The owner may have deleted a waiting job before this worker picked it up.

  const started = await db.query<{ id: string; attempts_in_cycle: number }>(
    `UPDATE jobs SET status = 'active', attempts = attempts + 1, attempts_in_cycle = attempts_in_cycle + 1, started_at = CURRENT_TIMESTAMP,
     completed_at = NULL, error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status IN ('waiting', 'active', 'delayed') RETURNING id, attempts_in_cycle`, [jobId]
  );
  if (!started.rows[0]) return; // Another worker or a prior delivery already moved the database row.
  workerMetrics.active += 1;

  try {
    await holdForDemoCrash(record.payload ?? {}, started.rows[0].attempts_in_cycle, jobId);
    const result = await runDemoHandler(record.type, record.payload ?? {}, job.attemptsMade + 1);
    await db.query(
      `UPDATE jobs SET status = 'completed', result = $2::jsonb, error = NULL,
       completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [jobId, JSON.stringify(result)]
    );
    workerMetrics.succeeded += 1;
    workerMetrics.processed += 1;
    workerMetrics.totalDurationMs += Date.now() - processingStarted;
    writeLog('worker', 'info', 'job_completed', { jobId, durationMs: Date.now() - processingStarted });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown job processing error';
    const attempts = job.opts.attempts ?? config.jobAttempts;
    const terminalFailure = job.attemptsMade + 1 >= attempts;
    if (!terminalFailure) workerMetrics.retries += 1;
    if (terminalFailure) {
      await db.query(
        `UPDATE jobs SET status = 'failed', error = $2, completed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [jobId, message]
      );
      workerMetrics.failed += 1;
      workerMetrics.processed += 1;
      workerMetrics.totalDurationMs += Date.now() - processingStarted;
    } else {
      await db.query(
        `UPDATE jobs SET status = 'delayed', error = $2, completed_at = NULL,
         updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [jobId, message]
      );
    }
    writeLog('worker', terminalFailure ? 'error' : 'warn', terminalFailure ? 'job_failed' : 'job_retry_scheduled', { jobId, error });
    throw error;
  } finally {
    workerMetrics.active = Math.max(0, workerMetrics.active - 1);
  }
};

export const startWorker = (): { close: () => Promise<void> } => {
  if (!config.redisUrl) throw new Error('REDIS_URL environment variable is missing.');
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  connection.on('error', (error) => writeLog('worker', 'error', 'redis_error', { error }));
  const worker = new Worker<QueueJobData>(QUEUE_NAME, processJob, {
    connection, concurrency: config.workerConcurrency,
    lockDuration: config.workerLockDurationMs,
    stalledInterval: config.workerStalledIntervalMs,
    maxStalledCount: config.workerMaxStalledCount
  });
  worker.on('failed', (job, error) => writeLog('worker', 'error', 'bull_job_failed', { jobId: job?.id, error }));
  worker.on('error', (error) => writeLog('worker', 'error', 'worker_error', { error }));
  let shuttingDown = false;
  let heartbeatInFlight: Promise<void> = Promise.resolve();
  const heartbeat = async () => {
    if (shuttingDown) return;
    try { await waitForRedisReady(connection); await connection.set('taskflow:worker:heartbeat', JSON.stringify({ ...workerMetrics, concurrency: config.workerConcurrency, shuttingDown: false, updatedAt: new Date().toISOString() }), 'EX', 30); }
    catch (error) { writeLog('worker', 'warn', 'heartbeat_update_failed', { error }); }
  };
  const runHeartbeat = () => { heartbeatInFlight = heartbeat(); };
  runHeartbeat();
  const timer = setInterval(runHeartbeat, 10000);
  timer.unref();
  const close = onceAsync(async () => {
    shuttingDown = true;
    clearInterval(timer);
    try {
      await waitForRedisReady(connection);
      await connection.set('taskflow:worker:heartbeat', JSON.stringify({ ...workerMetrics, concurrency: config.workerConcurrency, shuttingDown: true, updatedAt: new Date().toISOString() }), 'EX', 30);
    } catch (error) { writeLog('worker', 'warn', 'shutdown_heartbeat_update_failed', { error }); }
    const result = await drainWithGrace('worker', config.shutdownGracePeriodMs,
      async () => { await worker.pause(true); await heartbeatInFlight; await worker.close(); },
      async () => { await worker.close(true); });
    try { await connection.del('taskflow:worker:heartbeat'); } catch (error) { writeLog('worker', 'warn', 'shutdown_heartbeat_delete_failed', { error }); }
    try { await connection.quit(); } catch { connection.disconnect(); }
    await closeDb();
    logShutdownCompleted('worker', result.forced);
    if (result.forced) process.exitCode = 1;
  });
  return {
    close
  };
};

if (require.main === module) {
  let worker: ReturnType<typeof startWorker>;
  try {
    worker = startWorker();
    writeLog('worker', 'info', 'worker_started', { concurrency: config.workerConcurrency });
  } catch (error: unknown) {
    writeLog('worker', 'error', 'worker_startup_failed', { error });
    process.exit(1);
  }

  const shutdown = onceAsync(async () => { await worker.close(); });
  const onSignal = () => { void shutdown().then(() => { if (process.exitCode === 1) process.exit(1); }).catch((error) => { writeLog('worker', 'error', 'shutdown_failed', { error }); process.exit(1); }); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
}
