import IORedis from 'ioredis';

/** Wait until ioredis can safely accept commands, including when it was lazy-connected. */
export const waitForRedisReady = (client: IORedis, timeoutMs = 7000): Promise<void> => {
  if (client.status === 'ready') return Promise.resolve();
  if (client.status === 'end') return Promise.reject(new Error('Redis connection has ended'));

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      client.removeListener('ready', onReady);
      client.removeListener('error', onError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onError = (error: Error) => finish(error);
    const timer = setTimeout(() => finish(new Error('Timed out waiting for Redis connection')), timeoutMs);

    client.once('ready', onReady);
    client.once('error', onError);
    if (client.status === 'wait') client.connect().catch(onError);
  });
};
