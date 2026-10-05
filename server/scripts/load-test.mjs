import dotenv from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getWorkerConcurrency } from './benchmark-metrics.mjs';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const numberOption = (name, fallback, max) => {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be an integer from 1 to ${max}`);
  return value;
};
const jobs = numberOption('--jobs', 100, 2000);
const concurrency = numberOption('--concurrency', 5, 50);
const rawBaseUrl = option('--base-url', process.env.TASKFLOW_BASE_URL || 'http://localhost:5000');
const parsedBaseUrl = new URL(rawBaseUrl);
if (!['http:', 'https:'].includes(parsedBaseUrl.protocol) || parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
  throw new Error('--base-url must be an HTTP(S) origin without embedded credentials or query parameters.');
}
const baseUrl = parsedBaseUrl.origin;
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (!localHosts.has(parsedBaseUrl.hostname) && !args.includes('--allow-remote')) {
  throw new Error('Remote load-test targets require --allow-remote; use that flag only for a dedicated non-production target.');
}
const type = option('--type', 'report');
const waitForWorker = args.includes('--wait');
const timeoutSeconds = numberOption('--timeout-seconds', 300, 3600);
const email = process.env.TASKFLOW_EMAIL;
const password = process.env.TASKFLOW_PASSWORD;
if (!['email', 'report', 'data-processing'].includes(type)) throw new Error('--type must be email, report, or data-processing');
if (args.includes('--dry-run')) {
  console.log(JSON.stringify({ dryRun: true, target: baseUrl, configuredJobs: jobs, concurrency, totalRequests: jobs, jobType: type }, null, 2));
  process.exit(0);
}
if (!email || !password) throw new Error('Set TASKFLOW_EMAIL and TASKFLOW_PASSWORD in server/.env or the environment.');

const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password })
});
if (!loginResponse.ok) throw new Error(`Login failed with HTTP ${loginResponse.status}; check the account and target API.`);
const setCookies = typeof loginResponse.headers.getSetCookie === 'function'
  ? loginResponse.headers.getSetCookie() : [loginResponse.headers.get('set-cookie') ?? ''];
const cookie = setCookies.map((value) => value.split(';')[0]).find((value) => value.startsWith('token='));
if (!cookie) throw new Error('Login succeeded but no session cookie was returned.');

let workerConcurrency;
if (waitForWorker) {
  const metricsResponse = await fetch(`${baseUrl}/api/v1/metrics`, { headers: { cookie } });
  if (!metricsResponse.ok) throw new Error(`Could not read worker metrics (HTTP ${metricsResponse.status}); no benchmark jobs were submitted.`);
  const metrics = await metricsResponse.json();
  workerConcurrency = getWorkerConcurrency(metrics);
}

const samples = new Array(jobs);
const ids = new Array(jobs);
let next = 0;
const startedAt = performance.now();
const workers = Array.from({ length: Math.min(concurrency, jobs) }, async () => {
  while (true) {
    const index = next++;
    if (index >= jobs) return;
    const requestStarted = performance.now();
    try {
      const response = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie, 'idempotency-key': `load-${randomUUID()}` },
        body: JSON.stringify({ type, payload: { benchmark: true }, priority: 'normal' })
      });
      const body = await response.json().catch(() => ({}));
      samples[index] = { latencyMs: performance.now() - requestStarted, success: response.status === 201, status: response.status };
      ids[index] = body?.job?.id;
    } catch {
      samples[index] = { latencyMs: performance.now() - requestStarted, success: false, status: 'network_error' };
    }
  }
});
await Promise.all(workers);
const submissionDurationMs = performance.now() - startedAt;
const sorted = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
const percentile = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
const successful = samples.filter((sample) => sample.success).length;
const report = {
  target: baseUrl,
  jobType: type,
  configuredJobs: jobs,
  concurrency,
  totalRequests: jobs,
  successfulSubmissions: successful,
  failures: jobs - successful,
  submissionDurationMs: Number(submissionDurationMs.toFixed(2)),
  requestsPerSecond: Number((jobs / (submissionDurationMs / 1000)).toFixed(2)),
  averageSubmissionLatencyMs: Number((samples.reduce((total, sample) => total + sample.latencyMs, 0) / jobs).toFixed(2)),
  p50LatencyMs: Number(percentile(0.50).toFixed(2)),
  p95LatencyMs: Number(percentile(0.95).toFixed(2)),
  p99LatencyMs: Number(percentile(0.99).toFixed(2))
};

if (waitForWorker && successful > 0) {
  const pending = ids.filter(Boolean);
  const completed = [];
  const terminalFailures = [];
  const deadline = Date.now() + timeoutSeconds * 1000;
  let unfinished = pending;
  while (unfinished.length && Date.now() < deadline) {
    const stillPending = [];
    for (let offset = 0; offset < unfinished.length; offset += concurrency) {
      const batch = unfinished.slice(offset, offset + concurrency);
      const results = await Promise.all(batch.map(async (id) => {
        try {
          const response = await fetch(`${baseUrl}/api/v1/jobs/${encodeURIComponent(id)}`, { headers: { cookie } });
          const body = await response.json().catch(() => ({}));
          if (response.ok && body?.job?.status === 'completed') { completed.push(body.job); return null; }
          if (response.ok && body?.job?.status === 'failed') { terminalFailures.push(body.job); return null; }
        } catch { /* retry transient poll failures until timeout */ }
        return id;
      }));
      stillPending.push(...results.filter(Boolean));
    }
    unfinished = stillPending;
    if (unfinished.length) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const elapsedMs = Date.now() - (deadline - timeoutSeconds * 1000);
  report.workerBenchmark = {
    submittedJobIds: pending.length,
    jobsCompleted: completed.length,
    terminalFailures: terminalFailures.length,
    retries: [...completed, ...terminalFailures].reduce((total, job) => total + Math.max(0, Number(job.attempts ?? 1) - 1), 0),
    processingWindowMs: elapsedMs,
    throughputJobsPerSecond: Number((completed.length / Math.max(elapsedMs / 1000, 0.001)).toFixed(2)),
    timedOut: completed.length + terminalFailures.length < pending.length,
    workerConcurrency
  };
}

console.log(JSON.stringify(report, null, 2));
