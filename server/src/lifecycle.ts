import { writeLog, LogComponent } from './logger';

export interface ShutdownResult { forced: boolean; }

/** Wait for a safe drain up to the configured grace period, then invoke the component's force-close action. */
export const drainWithGrace = async (
  component: LogComponent,
  gracePeriodMs: number,
  drain: () => Promise<void>,
  force: () => Promise<void>
): Promise<ShutdownResult> => {
  writeLog(component, 'info', 'shutdown_started');
  writeLog(component, 'info', 'shutdown_draining', { gracePeriodMs });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const drained = drain().then(() => true, () => false);
  const expired = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), gracePeriodMs);
    timeout.unref?.();
  });
  const forced = !(await Promise.race([drained, expired]));
  if (timeout) clearTimeout(timeout);
  if (forced) {
    writeLog(component, 'warn', 'shutdown_timeout_forced', { gracePeriodMs });
    try { await force(); }
    catch (error: unknown) { writeLog(component, 'error', 'shutdown_force_failed', { error }); }
  }
  return { forced };
};

export const logShutdownCompleted = (component: LogComponent, forced: boolean): void =>
  writeLog(component, 'info', 'shutdown_completed', { forced });

let apiShuttingDown = false;
export const beginApiShutdown = (): void => { apiShuttingDown = true; };
export const isApiShuttingDown = (): boolean => apiShuttingDown;

/** Coalesce repeated OS signals so resources are cleaned up exactly once. */
export const onceAsync = <T>(action: () => Promise<T>): (() => Promise<T>) => {
  let result: Promise<T> | undefined;
  return () => result ??= action();
};
