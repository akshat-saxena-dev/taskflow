export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'cancelled';

export type JobPriority = 'low' | 'normal' | 'high' | 'critical';

export interface JobAttempt {
  attemptNumber: number;
  timestamp: string;
  status: 'completed' | 'failed';
  durationMs: number;
  error?: string;
}

export interface Job {
  id: string;
  type: string;
  queue: string;
  status: JobStatus;
  priority: JobPriority;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: string | null;
  attemptsHistory: JobAttempt[];
}

export interface DashboardStats {
  total: number;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

export interface QueueMetric {
  name: string;
  depth: number;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  throughputPerMinute: number;
  avgDurationMs: number;
}

export interface WorkerInfo {
  id: string;
  name: string;
  status: 'idle' | 'busy' | 'offline';
  concurrency: number;
  activeJobs: number;
  totalProcessed: number;
  totalFailed: number;
  uptimeSeconds: number;
}

export interface QueueStatsResponse {
  queues: QueueMetric[];
  workers: WorkerInfo[];
  totalThroughput: number;
  overallHealth: 'healthy' | 'degraded' | 'critical';
}
