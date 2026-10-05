export function getWorkerConcurrency(metrics) {
  const worker = metrics?.worker;
  if (worker?.alive !== true) throw new Error('Worker heartbeat is offline; cannot measure worker throughput.');
  if (!Number.isInteger(worker.concurrency) || worker.concurrency < 1) {
    throw new Error('Worker heartbeat does not contain a valid concurrency value.');
  }
  return worker.concurrency;
}
