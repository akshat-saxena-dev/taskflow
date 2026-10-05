import type { DashboardStats, Job, QueueStatsResponse } from '../types/job';
import { initialQueueStats } from './mockData';

export interface JobPage {
  jobs: Job[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

export interface OperationalMetrics {
  queue: { waiting: number; active: number; delayed: number; completed: number; failed: number };
  pressure?: { waiting: number; pending: number; maxWaiting: number; maxPending: number; overloaded: boolean };
  submissionRejections?: { rateLimited: number; backpressure: number };
  worker: { alive: boolean; processed?: number; succeeded?: number; failed?: number; retries?: number; active?: number; totalDurationMs?: number };
  outbox: { pending: number; processing: number; failed: number; processed: number; attempts: number; dispatchFailures: number };
  dispatcher: { alive: boolean };
  recovery: { detected: number; recovered: number; failures: number };
  shutdown?: { api: boolean; worker: boolean };
  observedAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/jobs${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session has expired. Please sign in again.');
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status})`);
  }
  return data as T;
}

const mapJob = (job: Job): Job => ({
  ...job,
  queue: job.type,
  maxAttempts: 0,
  attemptsHistory: [],
  failedAt: undefined
});

export const api = {
  async getOperationalMetrics(): Promise<OperationalMetrics> {
    const response = await fetch('/api/v1/metrics', { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Metrics unavailable (${response.status})`);
    return data as OperationalMetrics;
  },
  async getDashboardStats(): Promise<DashboardStats> {
    return request<DashboardStats>('/stats');
  },
  async getJobPage(options: { page?: number; limit?: number; status?: string } = {}): Promise<JobPage> {
    const query = new URLSearchParams();
    if (options.page !== undefined) query.set('page', String(options.page));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.status && options.status !== 'all') query.set('status', options.status);
    const suffix = query.size ? `?${query.toString()}` : '';
    const result = await request<JobPage>(suffix);
    return { ...result, jobs: result.jobs.map(mapJob) };
  },
  async getJobs(status?: string): Promise<Job[]> {
    return (await this.getJobPage({ status, limit: 100 })).jobs;
  },
  async createJob(input: { type: string; payload: Record<string, unknown>; priority: string }, idempotencyKey?: string): Promise<Job> {
    const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
    const result = await request<{ job: Job }>('', { method: 'POST', body: JSON.stringify(input), headers });
    return mapJob(result.job);
  },
  async getJobById(id: string): Promise<Job | null> {
    const result = await request<{ job: Job }>(`/${encodeURIComponent(id)}`);
    return mapJob(result.job);
  },
  async deleteJob(id: string): Promise<void> {
    await request<{ id: string }>(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async retryJob(id: string): Promise<Job> {
    const result = await request<{ job: Job }>(`/${encodeURIComponent(id)}/retry`, { method: 'POST' });
    return mapJob(result.job);
  },
  async getQueueStats(): Promise<QueueStatsResponse> {
    // Queue/worker telemetry is a later project stage; keep the existing static preview.
    return JSON.parse(JSON.stringify(initialQueueStats)) as QueueStatsResponse;
  }
};
