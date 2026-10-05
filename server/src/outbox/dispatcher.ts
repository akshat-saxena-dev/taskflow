import { db } from '../db';
import { config } from '../config';
import { queueService } from '../queue';
import { writeLog } from '../logger';

interface OutboxEvent { id: string; job_id: string; event_type: string; attempts: number; }
export interface OutboxStats { pending: number; processing: number; failed: number; processed: number; attempts: number; dispatchFailures: number; }

const errorText = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Unknown dispatch error';
  return message.replace(/(redis|rediss|postgres|postgresql):\/\/[^\s"']+/gi, '$1://[redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[redacted]').slice(0, 2000);
};

export const claimOutboxBatch = async (onlyJobId?: string): Promise<OutboxEvent[]> => {
  const result = await db.query<OutboxEvent>(
    `WITH candidates AS (
       SELECT id FROM outbox_events
       WHERE ((status IN ('pending', 'failed') AND available_at <= CURRENT_TIMESTAMP)
         OR (status = 'processing' AND updated_at <= CURRENT_TIMESTAMP - ($2 * INTERVAL '1 millisecond')))
         AND ($3::uuid IS NULL OR job_id = $3::uuid)
       ORDER BY created_at, id
       LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     UPDATE outbox_events AS event
     SET status = 'processing', attempts = event.attempts + 1, updated_at = CURRENT_TIMESTAMP
     FROM candidates WHERE event.id = candidates.id
     RETURNING event.id, event.job_id, event.event_type, event.attempts`,
    [config.dispatcherBatchSize, config.outboxClaimTimeoutMs, onlyJobId ?? null]
  );
  return result.rows;
};

export const dispatchOutboxOnce = async (): Promise<{ claimed: number; processed: number; failed: number }> => {
  const events = await claimOutboxBatch();
  let processed = 0;
  let failed = 0;
  for (const event of events) {
    try {
      if (event.event_type !== 'job.dispatch') throw new Error(`Unsupported outbox event type: ${event.event_type}`);
      await queueService.enqueue(event.job_id);
      await db.query(
        `UPDATE outbox_events SET status = 'processed', processed_at = CURRENT_TIMESTAMP,
         last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'processing'`,
        [event.id]
      );
      processed += 1;
      writeLog('dispatcher', 'info', 'outbox_event_dispatched', { eventId: event.id, jobId: event.job_id, attempt: event.attempts });
    } catch (error: unknown) {
      const message = errorText(error);
      const delayMs = Math.min(config.outboxRetryMaxMs, config.outboxRetryBaseMs * (2 ** Math.min(event.attempts - 1, 20)));
      await db.query(
        `UPDATE outbox_events SET status = 'failed', failures = failures + 1,
         available_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond'), last_error = $2,
         updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'processing'`,
        [event.id, message, delayMs]
      );
      failed += 1;
      writeLog('dispatcher', 'error', 'outbox_dispatch_failed', { eventId: event.id, jobId: event.job_id, attempt: event.attempts, error });
    }
  }
  return { claimed: events.length, processed, failed };
};

export const getOutboxStats = async (): Promise<OutboxStats> => {
  const result = await db.query<Record<string, number | string>>(
    `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
     COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
     COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
     COUNT(*) FILTER (WHERE status = 'processed')::int AS processed,
     COALESCE(SUM(attempts), 0)::int AS attempts,
     COALESCE(SUM(failures), 0)::int AS dispatch_failures FROM outbox_events`
  );
  const row = result.rows[0] ?? {};
  return {
    pending: Number(row.pending ?? 0), processing: Number(row.processing ?? 0),
    failed: Number(row.failed ?? 0), processed: Number(row.processed ?? 0),
    attempts: Number(row.attempts ?? 0), dispatchFailures: Number(row.dispatch_failures ?? 0)
  };
};
