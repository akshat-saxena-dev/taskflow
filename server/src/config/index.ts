import dotenv from 'dotenv';
import path from 'path';
import { writeLog } from '../logger';

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// Load environment variables from server/.env if present
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET?.trim()) {
  throw new Error('JWT_SECRET environment variable is required in production.');
}

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || '',
  redisUrl: process.env.REDIS_URL || '',
  jobAttempts: positiveInteger(process.env.JOB_ATTEMPTS, 3),
  jobBackoffDelayMs: positiveInteger(process.env.JOB_BACKOFF_DELAY_MS, 1000),
  jobStaleTimeoutMs: positiveInteger(process.env.JOB_STALE_TIMEOUT_MS, 600000),
  workerLockDurationMs: positiveInteger(process.env.WORKER_LOCK_DURATION_MS, 30000),
  workerStalledIntervalMs: positiveInteger(process.env.WORKER_STALLED_INTERVAL_MS, 30000),
  workerMaxStalledCount: positiveInteger(process.env.WORKER_MAX_STALLED_COUNT, 1),
  demoCrashHoldEnabled: process.env.NODE_ENV !== 'production' && process.env.TASKFLOW_ENABLE_DEMO_CRASH_HOLD === 'true',
  workerConcurrency: Math.min(100, positiveInteger(process.env.WORKER_CONCURRENCY, 5)),
  dispatcherPollIntervalMs: positiveInteger(process.env.DISPATCHER_POLL_INTERVAL_MS, 1000),
  shutdownGracePeriodMs: positiveInteger(process.env.SHUTDOWN_GRACE_PERIOD_MS, 30000),
  jobSubmissionRateLimit: positiveInteger(process.env.JOB_SUBMISSION_RATE_LIMIT, 60),
  jobSubmissionRateWindowMs: positiveInteger(process.env.JOB_SUBMISSION_RATE_WINDOW_MS, 60000),
  queueMaxWaitingJobs: positiveInteger(process.env.QUEUE_MAX_WAITING_JOBS, 10000),
  queueMaxPendingJobs: positiveInteger(process.env.QUEUE_MAX_PENDING_JOBS, 20000),
  queueBackpressureRetryAfterSeconds: positiveInteger(process.env.QUEUE_BACKPRESSURE_RETRY_AFTER_SECONDS, 5),
  dispatcherBatchSize: Math.min(100, positiveInteger(process.env.DISPATCHER_BATCH_SIZE, 20)),
  outboxClaimTimeoutMs: positiveInteger(process.env.OUTBOX_CLAIM_TIMEOUT_MS, 60000),
  outboxRetryBaseMs: positiveInteger(process.env.OUTBOX_RETRY_BASE_MS, 1000),
  outboxRetryMaxMs: positiveInteger(process.env.OUTBOX_RETRY_MAX_MS, 300000),
  jwtSecret: process.env.JWT_SECRET || 'taskflow_dev_jwt_secret_key_32_chars_minimum',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  isProduction: process.env.NODE_ENV === 'production'
};

// Safe configuration summary without logging sensitive secrets
export const logConfigStatus = () => {
  const isDbConfigured = Boolean(config.databaseUrl && config.databaseUrl.trim() !== '');
  writeLog('api', 'info', 'configuration', { environment: config.nodeEnv, port: config.port, databaseConfigured: isDbConfigured, redisConfigured: Boolean(config.redisUrl), clientUrl: config.clientUrl });
};
