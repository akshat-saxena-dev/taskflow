# TaskFlow

TaskFlow is a production-oriented distributed job processing platform
built to explore reliable background execution, queue-based
architecture, and failure handling.

Instead of executing expensive work directly inside an HTTP request,
TaskFlow accepts a job through an API, persists it in PostgreSQL,
records a transactional outbox event, dispatches that event to
BullMQ/Redis, and lets independent workers process the job
asynchronously.

## Why this project exists

The project focuses on the engineering problems that appear once a
simple "API + database" application needs to handle:

-   asynchronous background work
-   retries and exponential backoff
-   duplicate client requests
-   process crashes
-   queue outages
-   worker/dispatcher restarts
-   rate limiting
-   queue backpressure
-   graceful shutdown
-   observability
-   horizontal worker scaling
-   production deployment

## Architecture

``` mermaid
flowchart TD
    B[Browser] --> F[React + Vite / Nginx]
    F --> A[Express API]
    A --> DB[(Neon PostgreSQL)]
    A --> R[(Upstash Redis)]
    DB --> O[Transactional Outbox]
    O --> D[Dispatcher]
    D --> R
    R --> Q[BullMQ]
    Q --> W[Worker]
    W --> DB
    A --> M[Metrics / Health / Readiness]
    M --> F
```

### Job lifecycle

``` text
Client
  |
  | POST /api/v1/jobs
  v
API
  |
  | PostgreSQL transaction
  | 1. Insert job
  | 2. Insert job.dispatch outbox event
  v
PostgreSQL
  |
  | Dispatcher polls outbox
  v
Dispatcher
  |
  | BullMQ job
  v
Redis
  |
  v
Worker
  |
  | execute handler
  v
PostgreSQL
  |
  v
Completed / Failed
```

The key reliability property is that the job row and its outbox event
are committed in the same PostgreSQL transaction. This prevents the
classic failure where a database row exists but the queue message is
lost.

## Core engineering features

### Transactional Outbox

Job creation and the `job.dispatch` event are written atomically to
PostgreSQL.

The dispatcher uses row locking with `FOR UPDATE SKIP LOCKED`, allowing
multiple dispatcher instances to work without processing the same outbox
row concurrently.

Existing waiting/delayed jobs can also be safely backfilled into the
outbox.

### Idempotency

`POST /api/v1/jobs` accepts an optional `Idempotency-Key`.

Keys are scoped per user.

The database has a unique constraint on:

``` text
(user_id, idempotency_key)
```

A replay of the same request returns the existing job instead of
creating and dispatching another one.

A conflicting reuse with different job properties returns
`409 Conflict`.

### Retries

Jobs use BullMQ attempts and exponential backoff.

The default configuration supports three attempts, with configurable:

``` text
JOB_ATTEMPTS
JOB_BACKOFF_DELAY_MS
```

Temporary failures can therefore be retried without requiring the client
to resubmit the job.

### Worker crash recovery

The dispatcher periodically reconciles stale active jobs.

Recovery is lock-aware: an active BullMQ job with a valid lock is
protected, while an abandoned job whose worker lock has expired can be
recovered and re-enqueued.

PostgreSQL tracks both cumulative attempts and attempts within the
current recovery cycle.

### Rate limiting

Job submission is protected by a Redis-backed per-user rate limiter.

Default configuration:

``` text
JOB_SUBMISSION_RATE_LIMIT=60
JOB_SUBMISSION_RATE_WINDOW_MS=60000
```

The API returns `429` with rate-limit headers when the limit is
exceeded.

### Queue backpressure

The API checks queue pressure before admitting new work.

Pressure includes BullMQ waiting/active/delayed work and
pending/processing/retryable outbox work.

Admission uses a PostgreSQL advisory lock to coordinate capacity
decisions across API instances.

When capacity is exceeded, the API returns:

``` text
503 QUEUE_BACKPRESSURE
```

with a retry hint.

### Graceful shutdown

API, worker, and dispatcher processes handle `SIGINT`/`SIGTERM`.

Workers stop accepting new work and drain active processing during the
configured grace period.

Default:

``` text
SHUTDOWN_GRACE_PERIOD_MS=30000
```

### Observability

TaskFlow exposes:

-   `/health`
-   `/ready`
-   authenticated `/api/v1/metrics`
-   structured request logs
-   worker logs
-   dispatcher logs
-   queue statistics
-   worker heartbeat
-   Redis heartbeat
-   recovery counters
-   rate-limit/backpressure counters
-   outbox status

### Docker

The application is containerized as four runtime components:

``` text
Frontend / Nginx
API
Worker
Dispatcher
```

Neon PostgreSQL and Upstash Redis remain external managed services.

The frontend uses a multi-stage build and unprivileged Nginx. The
backend image is reused by the API, worker, and dispatcher.

### CI/CD

GitHub Actions provides CI and container publishing.

The pipeline validates the application and publishes Docker images to
GitHub Container Registry.

### Production deployment

TaskFlow is deployed on Railway as four services:

``` text
taskflow             -> API
upbeat-motivation     -> Worker
taskflow-dispatcher   -> Dispatcher
taskflow-frontend     -> Frontend
```

The frontend Nginx proxies `/api/*` to the API service.

Production infrastructure:

``` text
Railway
├── Frontend
├── API
├── Worker
└── Dispatcher

External managed services
├── Neon PostgreSQL
└── Upstash Redis
```

## Load testing

A built-in load-test script was added under:

``` text
server/scripts/load-test.mjs
```

The benchmark submits jobs and reports submission and processing
throughput plus latency percentiles.

Representative 500-job runs:

  --------------------------------------------------------------------------------------
         Worker     Jobs   Submission       Avg      P50      P95       P99   Processing
    concurrency                 req/s   latency                               throughput
  ------------- -------- ------------ --------- -------- -------- --------- ------------
              5      500        40.87 242.99 ms   208.30   314.54   1114 ms 10.40 jobs/s
                                                      ms       ms           

             10      500        41.37 239.31 ms   200.27   393.15   1126.69 35.91 jobs/s
                                                      ms       ms        ms 

             20      500        39.17 253.78 ms   210.62   373.18   1250.72 59.67 jobs/s
                                                      ms       ms        ms 
  --------------------------------------------------------------------------------------

All recorded runs completed 500/500 jobs without failures, retries, or
timeouts.

The observed processing throughput improved substantially as worker
concurrency increased, while submission throughput remained constrained
by API/database/queue admission overhead.

## Local development

### Prerequisites

-   Node.js
-   Docker Desktop
-   PostgreSQL-compatible database
-   Redis-compatible service

### Main commands

``` bash
npm run dev
npm run server:dev
npm run server:worker:dev
npm run server:dispatcher:dev
```

### Docker Compose

``` bash
docker compose up --build
```

The local Compose architecture runs the frontend, API, worker, and
dispatcher together while using the configured external PostgreSQL and
Redis services.

## Testing

Backend tests cover the core API, reliability, idempotency, outbox,
recovery, rate limiting, backpressure, and shutdown behavior.

The final validation reached:

``` text
84 passed
0 failed
3 skipped
```

## Repository structure

``` text
taskFlow/
├── server/
│   ├── src/
│   ├── scripts/
│   ├── Dockerfile
│   └── ...
├── src/
├── public/
├── docker/
│   └── nginx.conf
├── Dockerfile.frontend
├── docker-compose.yml
├── docker-compose.prod.yml
├── .github/
│   └── workflows/
├── docs/
└── README.md
```

## Engineering lessons

The project is intentionally centered on failure modes rather than only
feature development.

The main lessons are:

1.  A database write and a queue publish are not automatically atomic.
2.  Idempotency must be enforced at the database boundary, not only in
    application memory.
3.  A worker being "running" does not guarantee that a job is still
    being processed.
4.  Queue pressure needs admission control before the system becomes
    overloaded.
5.  Graceful shutdown matters when jobs can run longer than an HTTP
    request.
6.  Production observability should expose dependency health and
    operational state.
7.  Increasing worker concurrency improves throughput only until another
    part of the system becomes the bottleneck.

## Status

TaskFlow is deployed and has been production-smoke-tested across its
frontend, API, worker, dispatcher, PostgreSQL, Redis, authentication,
queue processing, retries, idempotency, and reliability paths.
