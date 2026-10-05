import { Request, Response } from 'express';
import { db } from '../db';
import { queueService, queueObservability } from '../queue';
import { SUPPORTED_JOB_TYPES } from '../workers/handlers';
import { writeLog } from '../logger';
import { queueBackpressureResponse } from '../middleware/submissionControls';

const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
const PRIORITY_VALUE: Record<(typeof PRIORITIES)[number], number> = { low: 0, normal: 1, high: 2, critical: 3 };
const VALID_STATUSES = ['waiting', 'active', 'completed', 'failed', 'delayed', 'cancelled'] as const;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class QueueAtCapacityError extends Error {}
class QueuePressureUnavailableError extends Error {}

export interface JobRow {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown>;
  status: string;
  priority: number;
  attempts: number;
  attempts_in_cycle?: number;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export const formatJob = (row: JobRow) => ({
  id: row.id,
  userId: row.user_id,
  type: row.type,
  payload: row.payload ?? {},
  status: row.status,
  priority: PRIORITIES[row.priority] ?? 'normal',
  priorityValue: row.priority,
  attempts: row.attempts,
  result: row.result,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  startedAt: row.started_at,
  completedAt: row.completed_at
});

export const createJob = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'Request body must be a JSON object' }); return;
    }
    const idempotencyHeader = req.headers['idempotency-key'];
    if (Array.isArray(idempotencyHeader)) { res.status(400).json({ error: 'Idempotency-Key must be a single value' }); return; }
    const idempotencyKey = typeof idempotencyHeader === 'string' ? idempotencyHeader.trim() : null;
    if (idempotencyHeader !== undefined && (!idempotencyKey || [...idempotencyKey].length > 255)) {
      res.status(400).json({ error: 'Idempotency-Key must contain between 1 and 255 characters' }); return;
    }
    const { type, payload = {}, priority = 'normal' } = req.body;
    if (typeof type !== 'string' || !type.trim()) { res.status(400).json({ error: 'Job type is required and must be a non-empty string' }); return; }
    if (!SUPPORTED_JOB_TYPES.includes(type.trim() as (typeof SUPPORTED_JOB_TYPES)[number])) {
      res.status(400).json({ error: `Unsupported job type. Allowed values: ${SUPPORTED_JOB_TYPES.join(', ')}` }); return;
    }
    if (typeof priority !== 'string' || !PRIORITIES.includes(priority.toLowerCase() as (typeof PRIORITIES)[number])) {
      res.status(400).json({ error: `Invalid priority. Allowed values are: ${PRIORITIES.join(', ')}` }); return;
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      res.status(400).json({ error: 'Payload must be a JSON object' }); return;
    }

    const normalizedPriority = priority.toLowerCase() as (typeof PRIORITIES)[number];
    // Resolve an idempotent replay before checking capacity: it adds no new queue work.
    if (idempotencyKey) {
      const existing = await db.query<JobRow & { same_request: boolean }>(
        `SELECT id, user_id, type, payload, status, priority, attempts, result, error, created_at, updated_at, started_at, completed_at,
         (type = $3 AND priority = $4 AND payload = $5::jsonb) AS same_request
         FROM jobs WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey, type.trim(), PRIORITY_VALUE[normalizedPriority], JSON.stringify(payload)]
      );
      if (existing.rows[0]) {
        if (!existing.rows[0].same_request) {
          res.status(409).json({ error: 'Idempotency-Key was already used with a different job request' });
          return;
        }
        res.status(200).json({ job: formatJob(existing.rows[0]) });
        return;
      }
    }
    const result = await db.transaction(async (transaction) => {
      // A transaction-scoped lock serializes capacity admission across API instances.
      // The job and Outbox event are still committed atomically in this transaction.
      await transaction.query('SELECT pg_advisory_xact_lock(734281042)');
      if (idempotencyKey) {
        const concurrentReplay = await transaction.query<JobRow & { same_request: boolean }>(
          `SELECT id, user_id, type, payload, status, priority, attempts, result, error, created_at, updated_at, started_at, completed_at,
           (type = $3 AND priority = $4 AND payload = $5::jsonb) AS same_request
           FROM jobs WHERE user_id = $1 AND idempotency_key = $2`,
          [userId, idempotencyKey, type.trim(), PRIORITY_VALUE[normalizedPriority], JSON.stringify(payload)]
        );
        if (concurrentReplay.rows[0]) return { inserted: null, replay: concurrentReplay.rows[0] };
      }
      const outboxBacklog = await transaction.query<{ pending: number | string }>(
        `SELECT COUNT(*)::int AS pending FROM outbox_events WHERE status IN ('pending', 'processing', 'failed')`
      );
      let pressure: Awaited<ReturnType<typeof queueObservability.pressure>>;
      try { pressure = await queueObservability.pressure(Number(outboxBacklog.rows[0]?.pending ?? 0)); }
      catch { throw new QueuePressureUnavailableError('Queue capacity is unavailable'); }
      if (pressure.overloaded) throw new QueueAtCapacityError('Queue capacity reached');
      const inserted = await transaction.query<JobRow>(
        `INSERT INTO jobs (user_id, type, payload, priority, idempotency_key, attempts_in_cycle)
         VALUES ($1, $2, $3::jsonb, $4, $5, 0)
         ON CONFLICT (user_id, idempotency_key) DO NOTHING
         RETURNING id, user_id, type, payload, status, priority, attempts, result, error, created_at, updated_at, started_at, completed_at`,
        [userId, type.trim(), JSON.stringify(payload), PRIORITY_VALUE[normalizedPriority], idempotencyKey]
      );
      if (inserted.rows[0]) {
        await transaction.query(
          `INSERT INTO outbox_events (job_id, event_type) VALUES ($1, 'job.dispatch')
           ON CONFLICT (job_id, event_type) DO NOTHING`,
          [inserted.rows[0].id]
        );
      }
      return { inserted: inserted.rows[0] ?? null, replay: null };
    });
    if (result.replay) {
      if (!result.replay.same_request) {
        res.status(409).json({ error: 'Idempotency-Key was already used with a different job request' });
        return;
      }
      res.status(200).json({ job: formatJob(result.replay) });
      return;
    }
    const row = result.inserted;
    if (!row && idempotencyKey) {
      const existing = await db.query<JobRow & { same_request: boolean }>(
        `SELECT id, user_id, type, payload, status, priority, attempts, result, error, created_at, updated_at, started_at, completed_at,
         (type = $3 AND priority = $4 AND payload = $5::jsonb) AS same_request
         FROM jobs WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey, type.trim(), PRIORITY_VALUE[normalizedPriority], JSON.stringify(payload)]
      );
      const existingRow = existing.rows[0];
      if (!existingRow) throw new Error('Idempotency conflict row was not found');
      if (!existingRow.same_request) {
        res.status(409).json({ error: 'Idempotency-Key was already used with a different job request' });
        return;
      }
      res.status(200).json({ job: formatJob(existingRow) });
      return;
    }
    if (!row) throw new Error('Job insert did not return a row');
    res.status(201).json({ job: formatJob(row) });
  } catch (err: unknown) {
    if (err instanceof QueueAtCapacityError) {
      try { await queueService.recordSubmissionRejection('backpressure'); } catch { /* queue metrics must not change the rejection */ }
      writeLog('api', 'warn', 'job_submission_backpressure', { userId: req.user?.id });
      queueBackpressureResponse(res);
      return;
    }
    if (err instanceof QueuePressureUnavailableError) {
      writeLog('api', 'error', 'job_submission_capacity_check_failed', { userId: req.user?.id, error: err });
      res.setHeader('Retry-After', '5');
      res.status(503).json({ error: 'Queue capacity is temporarily unavailable', code: 'QUEUE_CAPACITY_UNAVAILABLE' });
      return;
    }
    writeLog('api', 'error', 'job_create_failed', { userId: req.user?.id, error: err });
    res.status(500).json({ error: 'Failed to create job' });
  }
};

export const listJobs = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const one = (value: unknown) => typeof value === 'string' ? value : undefined;
    const pageRaw = one(req.query.page) ?? '1';
    const limitRaw = one(req.query.limit) ?? '10';
    if ((req.query.page !== undefined && !one(req.query.page)) || (req.query.limit !== undefined && !one(req.query.limit))) {
      res.status(400).json({ error: 'page and limit must each be a single value' }); return;
    }
    if (!/^\d+$/.test(pageRaw) || Number(pageRaw) < 1 || !/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 100) {
      res.status(400).json({ error: 'page must be a positive integer and limit must be between 1 and 100' }); return;
    }
    const page = Number(pageRaw);
    const limit = Number(limitRaw);
    if (!Number.isSafeInteger((page - 1) * limit)) { res.status(400).json({ error: 'Requested page is out of range' }); return; }
    const status = one(req.query.status);
    if (req.query.status !== undefined && status === undefined) { res.status(400).json({ error: 'status must be a single value' }); return; }
    if (status && status !== 'all' && !VALID_STATUSES.includes(status.toLowerCase() as (typeof VALID_STATUSES)[number])) {
      res.status(400).json({ error: `Invalid status filter. Allowed values: all, ${VALID_STATUSES.join(', ')}` }); return;
    }

    const params: unknown[] = [userId];
    const where = status && status !== 'all' ? (params.push(status.toLowerCase()), `WHERE user_id = $1 AND status = $2`) : 'WHERE user_id = $1';
    const count = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM jobs ${where}`, params);
    const total = Number(count.rows[0]?.count ?? 0);
    const dataParams = [...params, limit, (page - 1) * limit];
    const data = await db.query<JobRow>(
      `SELECT id, user_id, type, payload, status, priority, attempts, result, error, created_at, updated_at, started_at, completed_at
       FROM jobs ${where} ORDER BY created_at DESC, id DESC LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );
    res.status(200).json({ jobs: data.rows.map(formatJob), pagination: { total, page, limit, totalPages: Math.ceil(total / limit) } });
  } catch (err: unknown) {
    writeLog('api', 'error', 'job_list_failed', { userId: req.user?.id, error: err });
    res.status(500).json({ error: 'Failed to retrieve jobs' });
  }
};

export const getJobStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const result = await db.query<Record<string, number | string>>(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'waiting')::int AS waiting,
       COUNT(*) FILTER (WHERE status = 'active')::int AS active, COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed, COUNT(*) FILTER (WHERE status = 'delayed')::int AS delayed,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled FROM jobs WHERE user_id = $1`, [userId]
    );
    const stats = result.rows[0] ?? {};
    res.status(200).json(Object.fromEntries(['total', ...VALID_STATUSES].map((key) => [key, Number(stats[key] ?? 0)])));
  } catch (err: unknown) {
    writeLog('api', 'error', 'job_stats_failed', { userId: req.user?.id, error: err });
    res.status(500).json({ error: 'Failed to retrieve job statistics' });
  }
};

export const getJobById = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!UUID_REGEX.test(id)) { res.status(400).json({ error: 'Invalid job ID' }); return; }
    const result = await db.query<JobRow>(
      `SELECT id, user_id, type, payload, status, priority, attempts, result, error, created_at, updated_at, started_at, completed_at FROM jobs WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (!result.rows[0]) { res.status(404).json({ error: 'Job not found' }); return; }
    res.status(200).json({ job: formatJob(result.rows[0]) });
  } catch (err: unknown) {
    writeLog('api', 'error', 'job_get_failed', { userId: req.user?.id, error: err });
    res.status(500).json({ error: 'Failed to retrieve job details' });
  }
};

export const retryJob = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!UUID_REGEX.test(id)) { res.status(400).json({ error: 'Invalid job ID' }); return; }

    const found = await db.query<JobRow>(
      `SELECT id, user_id, type, payload, status, priority, attempts, attempts_in_cycle, result, error, created_at, updated_at, started_at, completed_at
       FROM jobs WHERE id = $1 AND user_id = $2`, [id, userId]
    );
    const previous = found.rows[0];
    if (!previous) { res.status(404).json({ error: 'Job not found' }); return; }
    if (previous.status !== 'failed') { res.status(409).json({ error: 'Only failed jobs can be retried' }); return; }

    const reserved = await db.query<JobRow>(
      `UPDATE jobs SET status = 'waiting', error = NULL, result = NULL, started_at = NULL, completed_at = NULL, attempts_in_cycle = 0
       WHERE id = $1 AND user_id = $2 AND status = 'failed'
       RETURNING id, user_id, type, payload, status, priority, attempts, result, error, created_at, updated_at, started_at, completed_at`,
      [id, userId]
    );
    if (!reserved.rows[0]) { res.status(409).json({ error: 'This job is already being retried' }); return; }

    try {
      await queueService.retryFailed(id);
    } catch (queueError: unknown) {
      const message = queueError instanceof Error ? queueError.message : 'Unknown Redis retry error';
      const restored = await db.query<JobRow>(
        `UPDATE jobs SET status = 'failed', error = $2, completed_at = $3, attempts_in_cycle = $5
         WHERE id = $1 AND user_id = $4 AND status = 'waiting'
         RETURNING id, user_id, type, payload, status, priority, attempts, result, error, created_at, updated_at, started_at, completed_at`,
        [id, `${previous.error ?? 'Job failed'}; Retry enqueue failed: ${message}`, previous.completed_at, userId, previous.attempts_in_cycle ?? previous.attempts]
      );
      res.status(503).json({ error: 'Failed to queue job retry', job: formatJob(restored.rows[0] ?? reserved.rows[0]) });
      return;
    }

    const current = await db.query<JobRow>(
      `SELECT id, user_id, type, payload, status, priority, attempts, result, error, created_at, updated_at, started_at, completed_at
       FROM jobs WHERE id = $1 AND user_id = $2`, [id, userId]
    );
    res.status(202).json({ job: formatJob(current.rows[0] ?? reserved.rows[0]) });
  } catch (err: unknown) {
    writeLog('api', 'error', 'job_retry_failed', { userId: req.user?.id, error: err });
    res.status(500).json({ error: 'Failed to retry job' });
  }
};

export const deleteJob = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!UUID_REGEX.test(id)) { res.status(400).json({ error: 'Invalid job ID' }); return; }
    const result = await db.query<{ id: string }>(
      `DELETE FROM jobs WHERE id = $1 AND user_id = $2 AND status <> 'active' RETURNING id`, [id, userId]
    );
    if (!result.rows[0]) {
      const owned = await db.query<{ status: string }>('SELECT status FROM jobs WHERE id = $1 AND user_id = $2', [id, userId]);
      if (!owned.rows[0]) { res.status(404).json({ error: 'Job not found' }); return; }
      res.status(409).json({ error: 'Cannot delete an active job' }); return;
    }
    res.status(200).json({ id: result.rows[0].id, message: 'Job deleted successfully' });
  } catch (err: unknown) {
    writeLog('api', 'error', 'job_delete_failed', { userId: req.user?.id, error: err });
    res.status(500).json({ error: 'Failed to delete job' });
  }
};
