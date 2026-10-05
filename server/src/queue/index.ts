import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createHash } from 'crypto';
import { config } from '../config';
import { writeLog } from '../logger';
import { waitForRedisReady } from './redisReady';

export const QUEUE_NAME = 'taskflow-jobs';
export interface QueueJobData { jobId: string; }
export type StaleQueueState = 'missing' | 'active' | 'waiting' | 'delayed' | 'failed' | 'completed' | 'other';
export interface StaleQueueJob { state: StaleQueueState; attemptsMade?: number; maxAttempts?: number; stalledCount?: number; error?: string; lockValid?: boolean; stalledCheck?: 'not-needed' | 'pending' | 'moved'; }
const RECOVERY_METRICS_KEY = 'taskflow:recovery:metrics';
const SUBMISSION_METRICS_KEY = 'taskflow:submission:metrics';
const RATE_LIMIT_SCRIPT = `local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return {count, redis.call('PTTL', KEYS[1])}`;
export const submissionRateLimitKey = (userId: string, nowMs = Date.now(), windowMs = config.jobSubmissionRateWindowMs): string =>
  `taskflow:rate:job-submit:${createHash('sha256').update(userId).digest('hex')}:${Math.floor(nowMs / windowMs)}`;
export const defaultJobOptions = () => ({
  attempts: config.jobAttempts,
  backoff: { type: 'exponential' as const, delay: config.jobBackoffDelayMs }
});

let redis: IORedis | null = null;
let queue: Queue<QueueJobData> | null = null;

const getQueueConnection = (): IORedis => {
  getQueue();
  return redis!;
};

const getStaleQueueState = async (jobId: string): Promise<StaleQueueJob> => {
  const activeQueue = getQueue();
  const job = await activeQueue.getJob(jobId);
  if (!job) return { state: 'missing', stalledCheck: 'not-needed' };
  const state = await job.getState();
  const mapped: StaleQueueState = ['active', 'waiting', 'delayed', 'failed', 'completed'].includes(state)
    ? state as StaleQueueState : 'other';
  const lockValid = mapped === 'active'
    ? (await redis!.exists(`${activeQueue.toKey(jobId)}:lock`)) > 0
    : undefined;
  return { state: mapped, attemptsMade: job.attemptsMade, maxAttempts: job.opts.attempts, stalledCount: job.stalledCounter, error: job.failedReason, lockValid, stalledCheck: 'not-needed' };
};

const getQueue = (): Queue<QueueJobData> => {
  if (!config.redisUrl) throw new Error('REDIS_URL environment variable is missing.');
  if (!redis) {
    // API producers and dispatcher requests fail promptly when Redis is unavailable.
    redis = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      lazyConnect: true
    });
    redis.on('error', (error) => writeLog('api', 'error', 'redis_error', { error }));
  }
  if (!queue) {
    queue = new Queue<QueueJobData>(QUEUE_NAME, { connection: redis });
    // BullMQ exposes stalled scanning on the backend; these worker options are
    // attached to its shared options object for the same Lua script semantics.
    Object.assign(queue.opts, {
      stalledInterval: config.workerStalledIntervalMs,
      maxStalledCount: config.workerMaxStalledCount
    });
  }
  return queue;
};

export const queueService = {
  async consumeSubmissionRateLimit(userId: string): Promise<{ allowed: boolean; limit: number; remaining: number; resetSeconds: number }> {
    getQueue();
    await waitForRedisReady(redis!);
    const key = submissionRateLimitKey(userId);
    const result = await redis!.eval(RATE_LIMIT_SCRIPT, 1, key, config.jobSubmissionRateWindowMs) as [number | string, number | string];
    const used = Number(result[0]);
    const ttlMs = Math.max(0, Number(result[1]));
    return { allowed: used <= config.jobSubmissionRateLimit, limit: config.jobSubmissionRateLimit,
      remaining: Math.max(0, config.jobSubmissionRateLimit - used), resetSeconds: Math.ceil(ttlMs / 1000) };
  },
  async recordSubmissionRejection(kind: 'rateLimited' | 'backpressure'): Promise<void> {
    getQueue();
    await waitForRedisReady(redis!);
    await redis!.hincrby(SUBMISSION_METRICS_KEY, kind, 1);
  },
  async enqueue(jobId: string): Promise<void> {
    const activeQueue = getQueue();
    await waitForRedisReady(redis!);
    await activeQueue.add('process', { jobId }, { jobId, ...defaultJobOptions() });
  },
  async retryFailed(jobId: string): Promise<void> {
    const activeQueue = getQueue();
    await waitForRedisReady(redis!);
    const existing = await activeQueue.getJob(jobId);
    if (!existing) {
      // The failed Redis record may have been removed; recreating with its stable ID is safe.
      await activeQueue.add('process', { jobId }, { jobId, ...defaultJobOptions() });
      return;
    }
    const state = await existing.getState();
    if (state !== 'failed') throw new Error(`Queue job is ${state}; only failed queue jobs can be retried.`);
    await existing.retry('failed', { resetAttemptsMade: true });
  },
  async reconcileStaleJob(jobId: string): Promise<StaleQueueJob> {
    const activeQueue = getQueue();
    await waitForRedisReady(getQueueConnection());
    const current = await getStaleQueueState(jobId);
    if (current.state !== 'active' || current.lockValid) return current;

    // BullMQ's Lua stalled checker validates the lock atomically, enforces its
    // stalled retry cap and moves only genuinely unlocked jobs back to waiting.
    const movedIds = await activeQueue.backend.moveStalledJobsToWait();
    const refreshed = await getStaleQueueState(jobId);
    return { ...refreshed, stalledCheck: movedIds.includes(jobId) ? 'moved' : 'pending' };
  },
  async requeueMissing(jobId: string): Promise<void> {
    const activeQueue = getQueue();
    await waitForRedisReady(redis!);
    // Reuses the PostgreSQL UUID as the BullMQ job ID, preserving deduplication.
    await activeQueue.add('process', { jobId }, { jobId, ...defaultJobOptions() });
  },
  async addRecoveryMetric(name: 'detected' | 'recovered' | 'failures'): Promise<void> {
    getQueue();
    await waitForRedisReady(redis!);
    await redis!.hincrby(RECOVERY_METRICS_KEY, name, 1);
  },
  async markStaleDetected(jobId: string, startedAt: Date): Promise<boolean> {
    getQueue();
    await waitForRedisReady(redis!);
    const key = `taskflow:recovery:detected:${jobId}:${startedAt.getTime()}`;
    return (await redis!.set(key, '1', 'EX', 86400, 'NX')) === 'OK';
  },
  async markStaleDecision(jobId: string, startedAt: Date, decision: string): Promise<boolean> {
    getQueue();
    await waitForRedisReady(redis!);
    const key = `taskflow:recovery:decision:${jobId}:${startedAt.getTime()}:${decision}`;
    return (await redis!.set(key, '1', 'EX', 86400, 'NX')) === 'OK';
  }
};

export const closeQueue = async (): Promise<void> => {
  if (queue) await queue.close();
  queue = null;
  if (redis) await redis.quit();
  redis = null;
};

export const queueObservability = {
  async counts() {
    const q = getQueue();
    await waitForRedisReady(redis!);
    const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    return { waiting: counts.waiting ?? 0, active: counts.active ?? 0, delayed: counts.delayed ?? 0, completed: counts.completed ?? 0, failed: counts.failed ?? 0 };
  },
  async pressure(outboxPending = 0) {
    const counts = await queueObservability.counts();
    const pending = counts.waiting + counts.active + counts.delayed + Math.max(0, outboxPending);
    return { waiting: counts.waiting, pending, maxWaiting: config.queueMaxWaitingJobs,
      maxPending: config.queueMaxPendingJobs,
      overloaded: counts.waiting >= config.queueMaxWaitingJobs || pending >= config.queueMaxPendingJobs };
  },
  async submissionRejections(): Promise<{ rateLimited: number; backpressure: number }> {
    getQueue();
    await waitForRedisReady(redis!);
    const values = await redis!.hgetall(SUBMISSION_METRICS_KEY);
    return { rateLimited: Number(values.rateLimited ?? 0), backpressure: Number(values.backpressure ?? 0) };
  },
  async redisReady() {
    getQueue();
    await waitForRedisReady(redis!);
    return (await redis!.ping()) === 'PONG';
  },
  async workerAlive() {
    getQueue();
    await waitForRedisReady(redis!);
    return Boolean(await redis!.get('taskflow:worker:heartbeat'));
  },
  async workerStatus(): Promise<Record<string, unknown> | null> {
    getQueue();
    await waitForRedisReady(redis!);
    const value = await redis!.get('taskflow:worker:heartbeat');
    if (!value) return null;
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
  },
  async dispatcherAlive(): Promise<boolean> {
    getQueue();
    await waitForRedisReady(redis!);
    return (await redis!.zcount('taskflow:dispatcher:heartbeats', Date.now() - 30000, '+inf')) > 0;
  },
  async recoveryMetrics(): Promise<{ detected: number; recovered: number; failures: number }> {
    getQueue();
    await waitForRedisReady(redis!);
    const values = await redis!.hgetall(RECOVERY_METRICS_KEY);
    return { detected: Number(values.detected ?? 0), recovered: Number(values.recovered ?? 0), failures: Number(values.failures ?? 0) };
  }
};
