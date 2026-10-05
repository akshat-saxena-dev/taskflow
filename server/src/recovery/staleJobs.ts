import { DbExecutor, db } from '../db';
import { config } from '../config';
import { queueService, StaleQueueJob } from '../queue';
import { writeLog } from '../logger';

interface StaleJob { id: string; attempts: number; attempts_in_cycle: number; error: string | null; started_at: Date; }
export interface RecoveryStats { detected: number; recovered: number; failures: number; }

const recordMetric = async (name: keyof RecoveryStats, count: number, jobId?: string): Promise<void> => {
  for (let i = 0; i < count; i += 1) {
    try { await queueService.addRecoveryMetric(name); }
    catch (error) { writeLog('dispatcher', 'warn', 'stale_recovery_metric_write_failed', { jobId, error }); }
  }
};

/**
 * Reconcile PostgreSQL rows left active after a worker disappeared. BullMQ remains
 * responsible for jobs still active in Redis; SKIP LOCKED coordinates dispatchers.
 * `now` is injectable so tests can age rows deterministically.
 */
export const recoverStaleJobsOnce = async (now = new Date()): Promise<RecoveryStats> => {
  const staleBefore = new Date(now.getTime() - config.jobStaleTimeoutMs);
  const stats: RecoveryStats = { detected: 0, recovered: 0, failures: 0 };
  try {
    await db.transaction(async (tx: DbExecutor) => {
      const selected = await tx.query<StaleJob>(
        `SELECT id, attempts, attempts_in_cycle, error, started_at FROM jobs
         WHERE status = 'active' AND started_at IS NOT NULL AND started_at <= $1
         ORDER BY started_at, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [staleBefore, 20]
      );

      for (const job of selected.rows) {
        let queueJob: StaleQueueJob;
        try {
          const firstDetection = await queueService.markStaleDetected(job.id, job.started_at);
          if (firstDetection) stats.detected += 1;
          queueJob = await queueService.reconcileStaleJob(job.id);
          if (queueJob.stalledCheck === 'moved' && (queueJob.stalledCount ?? 0) > config.workerMaxStalledCount) {
            queueJob = { ...queueJob, state: 'failed', error: 'job stalled more than allowable limit' };
          }
          if (firstDetection) {
            writeLog('dispatcher', 'warn', 'stale_job_detected', {
              jobId: job.id, attempts: job.attempts, startedAt: job.started_at,
              staleTimeoutMs: config.jobStaleTimeoutMs, queueState: queueJob.state,
              lockValid: queueJob.lockValid ?? null, stalledCheck: queueJob.stalledCheck ?? 'not-needed'
            });
          }
          if (queueJob.state === 'active') {
            const decision = queueJob.lockValid ? 'active_live_lock' : `active_lock_expired_${queueJob.stalledCheck ?? 'pending'}`;
            if (await queueService.markStaleDecision(job.id, job.started_at, decision)) {
              writeLog('dispatcher', 'info', 'stale_job_recovery_decision', {
                jobId: job.id, queueState: queueJob.state, lockValid: queueJob.lockValid ?? false,
                stalledCheck: queueJob.stalledCheck ?? 'pending', decision: queueJob.lockValid ? 'leave_running' : 'defer_to_bullmq_stalled_check'
              });
            }
            continue;
          }
          if (await queueService.markStaleDecision(job.id, job.started_at, queueJob.state)) {
            writeLog('dispatcher', 'info', 'stale_job_recovery_decision', {
              jobId: job.id, queueState: queueJob.state, lockValid: queueJob.lockValid ?? null,
              stalledCheck: queueJob.stalledCheck ?? 'not-needed', decision: 'reconcile_postgres'
            });
          }
          if (queueJob.state === 'missing') {
            const maxAttempts = config.jobAttempts;
            if (job.attempts_in_cycle >= maxAttempts) queueJob = { state: 'failed', attemptsMade: job.attempts_in_cycle, maxAttempts, error: 'Retry attempts exhausted during stale-job recovery' };
            else {
              await queueService.requeueMissing(job.id);
              queueJob = { state: 'waiting' };
            }
          }
        } catch (error) {
          stats.failures += 1;
          writeLog('dispatcher', 'error', 'stale_job_recovery_failed', { jobId: job.id, error });
          continue;
        }

        let update;
        if (queueJob.state === 'failed' || queueJob.state === 'completed') {
          const finalState = queueJob.state === 'failed' ? 'failed' : 'completed';
          const failure = queueJob.state === 'failed'
            ? queueJob.error || job.error || 'BullMQ exhausted retries while PostgreSQL remained active'
            : job.error || 'BullMQ completed while PostgreSQL status remained active';
          update = await tx.query(
            `UPDATE jobs SET status = $2::varchar, error = CASE WHEN $2::varchar = 'failed' THEN $3 ELSE error END,
             completed_at = COALESCE(completed_at, $4), updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'active' AND started_at <= $5 RETURNING id`,
            [job.id, finalState, failure, now, staleBefore]
          );
        } else {
          const status = queueJob.state === 'delayed' ? 'delayed' : 'waiting';
          update = await tx.query(
            `UPDATE jobs SET status = $2, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = $1 AND status = 'active' AND started_at <= $3 RETURNING id`,
            [job.id, status, staleBefore]
          );
        }
        if (update.rowCount) {
          stats.recovered += 1;
          writeLog('dispatcher', 'info', 'stale_job_recovered', { jobId: job.id, queueState: queueJob.state, status: queueJob.state === 'failed' ? 'failed' : queueJob.state === 'completed' ? 'completed' : queueJob.state === 'delayed' ? 'delayed' : 'waiting' });
        }
      }
    });
  } catch (error) {
    // The enclosing SQL transaction rolled back, so none of its status updates count.
    stats.recovered = 0;
    stats.failures += 1;
    writeLog('dispatcher', 'error', 'stale_job_recovery_failed', { error });
  }
  await recordMetric('detected', stats.detected);
  await recordMetric('recovered', stats.recovered);
  await recordMetric('failures', stats.failures);
  return stats;
};
