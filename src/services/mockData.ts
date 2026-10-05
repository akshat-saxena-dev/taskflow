import type { Job, QueueStatsResponse } from '../types/job';

export const initialJobs: Job[] = [
  {
    id: 'job-9842',
    type: 'email:welcome',
    queue: 'notifications',
    status: 'completed',
    priority: 'normal',
    attempts: 1,
    maxAttempts: 3,
    createdAt: '2026-10-02T01:15:20Z',
    startedAt: '2026-10-02T01:15:22Z',
    completedAt: '2026-10-02T01:15:24Z',
    payload: {
      userId: 'usr_78912',
      email: 'alex.rivera@example.com',
      template: 'welcome_v2',
      locale: 'en-US'
    },
    result: {
      messageId: 'msg_smtp_847192',
      deliveredAt: '2026-10-02T01:15:24Z',
      latencyMs: 182
    },
    error: null,
    attemptsHistory: [
      {
        attemptNumber: 1,
        timestamp: '2026-10-02T01:15:22Z',
        status: 'completed',
        durationMs: 1820
      }
    ]
  },
  {
    id: 'job-9843',
    type: 'invoice:pdf-generate',
    queue: 'documents',
    status: 'active',
    priority: 'high',
    attempts: 1,
    maxAttempts: 3,
    createdAt: '2026-10-02T01:28:10Z',
    startedAt: '2026-10-02T01:28:12Z',
    payload: {
      invoiceId: 'inv_2026_0921',
      billingCycle: 'September 2026',
      totalAmountUsd: 1420.50,
      renderOptions: { dpi: 300, includeAttachments: true }
    },
    result: null,
    error: null,
    attemptsHistory: []
  },
  {
    id: 'job-9844',
    type: 'webhook:stripe-event',
    queue: 'integrations',
    status: 'failed',
    priority: 'critical',
    attempts: 3,
    maxAttempts: 3,
    createdAt: '2026-10-02T01:05:00Z',
    startedAt: '2026-10-02T01:11:45Z',
    failedAt: '2026-10-02T01:12:00Z',
    payload: {
      eventId: 'evt_stripe_9921',
      endpoint: 'https://partner-api.internal/webhooks/billing',
      retriesExhausted: true
    },
    result: null,
    error: 'HTTP 504: Gateway Timeout after 15000ms. Destination server unreachable.',
    attemptsHistory: [
      {
        attemptNumber: 1,
        timestamp: '2026-10-02T01:05:05Z',
        status: 'failed',
        durationMs: 5020,
        error: 'Connection reset by peer'
      },
      {
        attemptNumber: 2,
        timestamp: '2026-10-02T01:07:30Z',
        status: 'failed',
        durationMs: 10040,
        error: 'HTTP 502: Bad Gateway'
      },
      {
        attemptNumber: 3,
        timestamp: '2026-10-02T01:11:45Z',
        status: 'failed',
        durationMs: 15012,
        error: 'HTTP 504: Gateway Timeout after 15000ms'
      }
    ]
  },
  {
    id: 'job-9845',
    type: 'media:video-transcode',
    queue: 'media-processing',
    status: 'waiting',
    priority: 'normal',
    attempts: 0,
    maxAttempts: 5,
    createdAt: '2026-10-02T01:32:00Z',
    payload: {
      assetId: 'ast_48102',
      sourceKey: 's3://media-ingest/raw/intro_4k.mov',
      outputFormats: ['1080p_mp4', '720p_webm', 'hls_adaptive']
    },
    result: null,
    error: null,
    attemptsHistory: []
  },
  {
    id: 'job-9846',
    type: 'sync:crm-contacts',
    queue: 'data-sync',
    status: 'waiting',
    priority: 'low',
    attempts: 0,
    maxAttempts: 3,
    createdAt: '2026-10-02T01:34:10Z',
    payload: {
      tenantId: 'cust_alpha_99',
      batchSize: 500,
      syncMode: 'incremental'
    },
    result: null,
    error: null,
    attemptsHistory: []
  },
  {
    id: 'job-9847',
    type: 'report:weekly-metrics',
    queue: 'documents',
    status: 'completed',
    priority: 'low',
    attempts: 1,
    maxAttempts: 2,
    createdAt: '2026-10-02T00:50:00Z',
    startedAt: '2026-10-02T00:50:02Z',
    completedAt: '2026-10-02T00:50:18Z',
    payload: {
      scope: 'organization',
      startDate: '2026-09-24',
      endDate: '2026-10-01'
    },
    result: {
      reportS3Uri: 's3://taskflow-reports/weekly-2026-w40.csv',
      rowsProcessed: 14890
    },
    error: null,
    attemptsHistory: [
      {
        attemptNumber: 1,
        timestamp: '2026-10-02T00:50:02Z',
        status: 'completed',
        durationMs: 16120
      }
    ]
  },
  {
    id: 'job-9848',
    type: 'index:elasticsearch-reindex',
    queue: 'data-sync',
    status: 'active',
    priority: 'normal',
    attempts: 1,
    maxAttempts: 3,
    createdAt: '2026-10-02T01:30:45Z',
    startedAt: '2026-10-02T01:30:50Z',
    payload: {
      indexName: 'products_v4',
      chunkIndex: 3,
      totalChunks: 10
    },
    result: null,
    error: null,
    attemptsHistory: []
  },
  {
    id: 'job-9849',
    type: 'audit:cleanup-expired-tokens',
    queue: 'maintenance',
    status: 'completed',
    priority: 'low',
    attempts: 1,
    maxAttempts: 1,
    createdAt: '2026-10-02T00:00:00Z',
    startedAt: '2026-10-02T00:00:01Z',
    completedAt: '2026-10-02T00:00:03Z',
    payload: {
      olderThanDays: 30
    },
    result: {
      tokensPurged: 3410
    },
    error: null,
    attemptsHistory: [
      {
        attemptNumber: 1,
        timestamp: '2026-10-02T00:00:01Z',
        status: 'completed',
        durationMs: 2310
      }
    ]
  }
];

export const initialQueueStats: QueueStatsResponse = {
  overallHealth: 'healthy',
  totalThroughput: 142,
  queues: [
    {
      name: 'notifications',
      depth: 12,
      waiting: 12,
      active: 4,
      completed: 1845,
      failed: 12,
      delayed: 0,
      throughputPerMinute: 65,
      avgDurationMs: 420
    },
    {
      name: 'documents',
      depth: 3,
      waiting: 3,
      active: 2,
      completed: 430,
      failed: 8,
      delayed: 1,
      throughputPerMinute: 18,
      avgDurationMs: 3400
    },
    {
      name: 'integrations',
      depth: 1,
      waiting: 1,
      active: 1,
      completed: 920,
      failed: 24,
      delayed: 5,
      throughputPerMinute: 32,
      avgDurationMs: 1100
    },
    {
      name: 'media-processing',
      depth: 5,
      waiting: 5,
      active: 3,
      completed: 112,
      failed: 3,
      delayed: 0,
      throughputPerMinute: 6,
      avgDurationMs: 14200
    },
    {
      name: 'data-sync',
      depth: 8,
      waiting: 8,
      active: 2,
      completed: 310,
      failed: 4,
      delayed: 2,
      throughputPerMinute: 21,
      avgDurationMs: 2100
    }
  ],
  workers: [
    {
      id: 'worker-node-01',
      name: 'Worker 01 (General)',
      status: 'busy',
      concurrency: 8,
      activeJobs: 5,
      totalProcessed: 1240,
      totalFailed: 14,
      uptimeSeconds: 86400 * 3 + 1200
    },
    {
      id: 'worker-node-02',
      name: 'Worker 02 (Media & Docs)',
      status: 'busy',
      concurrency: 4,
      activeJobs: 4,
      totalProcessed: 320,
      totalFailed: 5,
      uptimeSeconds: 86400 * 2 + 5400
    },
    {
      id: 'worker-node-03',
      name: 'Worker 03 (Integrations)',
      status: 'idle',
      concurrency: 10,
      activeJobs: 1,
      totalProcessed: 2100,
      totalFailed: 22,
      uptimeSeconds: 86400 * 5 + 3600
    },
    {
      id: 'worker-node-04',
      name: 'Worker 04 (Backup/Standby)',
      status: 'idle',
      concurrency: 8,
      activeJobs: 0,
      totalProcessed: 890,
      totalFailed: 3,
      uptimeSeconds: 86400 * 1 + 7200
    }
  ]
};
