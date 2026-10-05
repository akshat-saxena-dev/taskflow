import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { writeLog } from './logger';
export const requestLogging = (req: Request, res: Response, next: NextFunction) => {
  const supplied = req.header('x-request-id');
  const looksLikeJwt = supplied ? /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(supplied) : false;
  const requestId = supplied && /^[\w.-]{1,100}$/.test(supplied) && !looksLikeJwt ? supplied : randomUUID();
  res.setHeader('X-Request-ID', requestId);
  const started = Date.now();
  res.once('finish', () => writeLog('api', 'info', 'http_request', {
    requestId, method: req.method, path: req.path, statusCode: res.statusCode, durationMs: Date.now() - started,
    ...(req.user?.id ? { userId: req.user.id } : {})
  }));
  next();
};
