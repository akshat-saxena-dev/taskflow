import { app } from './app';
import { config, logConfigStatus } from './config';
import { checkDbConnection, closeDb } from './db';
import { closeQueue } from './queue';
import { beginApiShutdown, drainWithGrace, logShutdownCompleted, onceAsync } from './lifecycle';
import { writeLog } from './logger';

const startServer = async () => {
  logConfigStatus();
  const dbStatus = await checkDbConnection();
  if (dbStatus.connected) writeLog('api', 'info', 'postgres_connected');
  else writeLog('api', 'warn', 'postgres_not_connected', { message: dbStatus.message });

  const server = app.listen(config.port, "0.0.0.0", () => writeLog('api', 'info', 'server_listening', { port: config.port }));
  let closePromise: Promise<void> | undefined;
  const closeServer = () => closePromise ??= new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  const shutdown = onceAsync(async () => {
    beginApiShutdown();
    const result = await drainWithGrace('api', config.shutdownGracePeriodMs, closeServer, async () => {
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await closeServer();
    });
    const closed = await Promise.allSettled([closeQueue(), closeDb()]);
    closed.forEach((result) => { if (result.status === 'rejected') writeLog('api', 'error', 'shutdown_resource_close_failed', { error: result.reason }); });
    logShutdownCompleted('api', result.forced);
    process.exitCode = result.forced ? 1 : 0;
  });
  const onSignal = () => { void shutdown().then(() => { if (process.exitCode === 1) process.exit(1); }).catch((error) => { writeLog('api', 'error', 'shutdown_failed', { error }); process.exit(1); }); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
};

if (require.main === module) {
  startServer().catch((err) => {
    writeLog('api', 'error', 'startup_error', { error: err });
    process.exitCode = 1;
  });
}
