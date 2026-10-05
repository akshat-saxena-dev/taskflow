export type LogLevel = 'info' | 'warn' | 'error';
export type LogComponent = 'api' | 'worker' | 'dispatcher';
const secretKey = /password|token|cookie|authorization|secret|databaseurl|redisurl|payload/i;
const scrub = (value: unknown): unknown => {
  if (value instanceof Error) return { name: value.name, message: scrub(value.message) };
  if (typeof value === 'string') return value
    .replace(/(redis|rediss|postgres|postgresql):\/\/[^\s"']+/gi, '$1://[redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[redacted]');
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') return safeFields(value as Record<string, unknown>);
  return value;
};
const safeFields = (fields: Record<string, unknown> = {}) => Object.fromEntries(
  Object.entries(fields).filter(([key]) => !secretKey.test(key)).map(([key, value]) => [key, scrub(value)])
);
export const writeLog = (component: LogComponent, level: LogLevel, event: string, fields: Record<string, unknown> = {}) => {
  const entry = { timestamp: new Date().toISOString(), level, component, event, ...safeFields(fields) };
  const line = process.env.NODE_ENV === 'production' ? JSON.stringify(entry) : `${entry.timestamp} ${level.toUpperCase()} [${component}] ${event} ${JSON.stringify(safeFields(fields))}`;
  if (level === 'error') console.error(line); else if (level === 'warn') console.warn(line); else console.log(line);
};
