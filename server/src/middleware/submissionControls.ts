import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { isApiShuttingDown } from '../lifecycle';
import { queueService } from '../queue';
import { writeLog } from '../logger';

export type RateLimitResult = { allowed: boolean; limit: number; remaining: number; resetSeconds: number };
type Consume = (userId: string) => Promise<RateLimitResult>;

export const createSubmissionRateLimiter = (
  consume: Consume = (userId) => queueService.consumeSubmissionRateLimit(userId),
  recordRejection: () => Promise<void> = () => queueService.recordSubmissionRejection('rateLimited')
) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    if (isApiShuttingDown()) { res.setHeader('Retry-After', '1'); res.status(503).json({ error: 'API is shutting down', code: 'SHUTTING_DOWN' }); return; }
    try {
      const result = await consume(userId);
      res.setHeader('RateLimit-Limit', String(result.limit));
      res.setHeader('RateLimit-Remaining', String(result.remaining));
      res.setHeader('RateLimit-Reset', String(result.resetSeconds));
      if (!result.allowed) {
        writeLog('api', 'warn', 'job_submission_rate_limited', { userId });
        try { await recordRejection(); }
        catch (error: unknown) { writeLog('api', 'warn', 'submission_rejection_metric_failed', { error }); }
        res.setHeader('Retry-After', String(Math.max(1, result.resetSeconds)));
        res.status(429).json({ error: 'Job submission limit exceeded', code: 'RATE_LIMITED', retryAfterSeconds: Math.max(1, result.resetSeconds) });
        return;
      }
      next();
    } catch (error: unknown) {
      writeLog('api', 'error', 'job_submission_rate_limit_unavailable', { userId, error });
      res.setHeader('Retry-After', '5');
      res.status(503).json({ error: 'Job submission protection is temporarily unavailable', code: 'RATE_LIMIT_UNAVAILABLE' });
    }
  };

export const jobSubmissionRateLimiter = createSubmissionRateLimiter();

export const queueBackpressureResponse = (res: Response): void => {
  res.setHeader('Retry-After', String(config.queueBackpressureRetryAfterSeconds));
  res.status(503).json({ error: 'Job queue is temporarily at capacity', code: 'QUEUE_BACKPRESSURE', retryAfterSeconds: config.queueBackpressureRetryAfterSeconds });
};
