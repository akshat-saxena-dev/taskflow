import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { authRouter } from './routes/authRoutes';
import { jobRouter } from './routes/jobRoutes';
import { checkDbConnection } from './db';
import { queueObservability } from './queue';
import { requestLogging } from './observability';
import { authenticate } from './middleware/auth';
import { writeLog } from './logger';
import { workerMetrics } from './worker';
import { getOutboxStats } from './outbox/dispatcher';
import { isApiShuttingDown } from './lifecycle';

export const app = express();
app.use(requestLogging);

// Cross-Origin Resource Sharing (CORS) with credentials enabled for cookies
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID']
  })
);

// Body parsing and cookie parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get(['/health', '/api/health'], (_req: Request, res: Response) => res.status(200).json({ status: 'ok', service: 'taskflow-backend', timestamp: new Date().toISOString() }));
app.get('/ready', async (_req: Request, res: Response) => {
  const [database, redis, worker] = await Promise.all([
    checkDbConnection().then((result) => result.connected).catch(() => false),
    queueObservability.redisReady().catch(() => false),
    queueObservability.workerAlive().catch(() => false)
  ]);
  const ready = database && redis;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', dependencies: { database: database ? 'up' : 'down', redis: redis ? 'up' : 'down', worker: worker ? 'up' : 'down' } });
});
app.get('/api/v1/metrics', authenticate, async (_req: Request, res: Response) => {
  try {
    const [queue, worker, outbox, dispatcherAlive, recovery, submissionRejections] = await Promise.all([
      queueObservability.counts(), queueObservability.workerStatus(), getOutboxStats(), queueObservability.dispatcherAlive(), queueObservability.recoveryMetrics(), queueObservability.submissionRejections()
    ]);
    const pressure = await queueObservability.pressure(outbox.pending + outbox.processing + outbox.failed);
    res.json({
      queue, worker: worker ? { alive: true, ...worker } : { alive: false, ...workerMetrics },
      pressure, submissionRejections,
      outbox, dispatcher: { alive: dispatcherAlive }, recovery,
      shutdown: { api: isApiShuttingDown(), worker: Boolean(worker?.shuttingDown) }, observedAt: new Date().toISOString()
    });
  } catch {
    res.status(503).json({ error: 'Metrics temporarily unavailable' });
  }
});

// Authentication routes
app.use('/api/auth', authRouter);

// Job Management routes (v1)
app.use('/api/v1/jobs', jobRouter);

// 404 handler for undefined API routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if ('type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body contains invalid JSON' });
    return;
  }
  writeLog('api', 'error', 'unhandled_server_error', { error: err });
  res.status(500).json({ error: 'Internal server error' });
});
