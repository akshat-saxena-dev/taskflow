# React + TypeScript + Vite

## Docker deployment

Docker deployment runs the frontend, API, BullMQ worker, and transactional-outbox dispatcher as separate containers. Neon PostgreSQL and Upstash Redis remain external services; this stack does not start database or Redis containers. Docker Compose and Docker Engine/Desktop must be installed and running.

### Configure and start

Provide these values to Compose through your shell or an untracked root `.env` file (the repository ignores `.env` files). Do not commit credentials or include them in image builds:

- Required: `DATABASE_URL` (Neon connection string), `REDIS_URL` (Upstash TLS connection string, normally `rediss://...`), and `JWT_SECRET` (strong unique signing secret).
- `CLIENT_URL` must be the browser-visible frontend origin, defaulting to `http://localhost`. If you change `FRONTEND_PORT`, set this to the corresponding origin, such as `http://localhost:8080`.
- Optional tuning variables with application defaults: `JOB_ATTEMPTS`, `JOB_BACKOFF_DELAY_MS`, `JOB_STALE_TIMEOUT_MS`, `WORKER_CONCURRENCY`, `WORKER_LOCK_DURATION_MS`, `WORKER_STALLED_INTERVAL_MS`, `WORKER_MAX_STALLED_COUNT`, `DISPATCHER_POLL_INTERVAL_MS`, `DISPATCHER_BATCH_SIZE`, `OUTBOX_CLAIM_TIMEOUT_MS`, `OUTBOX_RETRY_BASE_MS`, `OUTBOX_RETRY_MAX_MS`, `JOB_SUBMISSION_RATE_LIMIT`, `JOB_SUBMISSION_RATE_WINDOW_MS`, `QUEUE_MAX_WAITING_JOBS`, `QUEUE_MAX_PENDING_JOBS`, `QUEUE_BACKPRESSURE_RETRY_AFTER_SECONDS`, and `SHUTDOWN_GRACE_PERIOD_MS`. `FRONTEND_PORT` optionally changes the host port (default `80`). The API listens on container port `5000`.

Build and start all four services:

```sh
docker compose up --build -d
```

Compose reads a root `.env` file for variable interpolation, or variables can be exported/set in the shell before running the command. The Compose configuration passes runtime secrets to the backend services; they are not build arguments or copied into images. The API, worker, and dispatcher each receive the shared database, Redis, JWT, client-origin, and tuning configuration.

The browser loads the static Vite build from Nginx. Nginx serves client-side routes with an `index.html` fallback and forwards `/api/` requests to the `api:5000` service name on the private Compose network. The browser therefore uses same-origin API URLs; the frontend image contains no backend secrets.

Check the API liveness and dependency readiness endpoints:

```sh
docker compose exec api node -e "fetch('http://127.0.0.1:5000/health').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
docker compose exec api node -e "fetch('http://127.0.0.1:5000/ready').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
```

`/health` is the API container liveness check and does not restart the container for a database or Redis outage. `/ready` separately reports dependency readiness and returns 503 when required dependencies are unavailable. Worker and dispatcher liveness can be followed in their logs and through their Redis heartbeats/metrics; they intentionally have no connectivity-based container healthcheck.

View service logs or stop the stack:

```sh
docker compose logs -f api worker dispatcher
docker compose down
```

After changing code or Docker configuration, rebuild and recreate services with `docker compose up --build -d`. To validate frontend-to-API routing, open the frontend origin and check a request such as `/api/auth/me` in the browser network panel; an unauthenticated request should receive the API's normal unauthenticated response rather than an Nginx 502/404.

## CI/CD and published images

### Continuous integration

GitHub Actions runs [CI](.github/workflows/ci.yml) for pushes to `main` and pull requests targeting `main`. It installs dependencies from both lockfiles, runs frontend lint/build, compiles the backend, runs the existing backend tests, validates the local Compose file, and builds the frontend, API, worker, and dispatcher Compose images. Integration tests that need `TEST_DATABASE_URL` retain their existing skip behavior when it is not configured. CI uses synthetic placeholder values only to satisfy Compose interpolation; it does not start services or connect to Neon or Upstash.

### Image publishing

After a successful CI run for a push to `main`, [CD](.github/workflows/cd.yml) publishes images to GitHub Container Registry (GHCR). It does not publish pull requests or feature branches and does not deploy or start the images. Image names use the repository owner and repository name from GitHub Actions, lowercased:

- `ghcr.io/<owner>/<repository>-frontend`
- `ghcr.io/<owner>/<repository>-api`
- `ghcr.io/<owner>/<repository>-worker`
- `ghcr.io/<owner>/<repository>-dispatcher`

Each name receives the full commit SHA as an immutable version tag and `latest` for the main branch. API, worker, and dispatcher tags point to the same backend runtime image build; the production Compose file selects the existing entrypoint command for each role. Publishing authenticates with the workflow's least-privilege `GITHUB_TOKEN` (`packages: write`); no personal access token is configured in the workflow.

To pull a particular commit's images, set the prefix to your repository and the tag to the full commit SHA:

```sh
export GHCR_IMAGE_PREFIX=ghcr.io/OWNER/REPOSITORY
export TASKFLOW_IMAGE_TAG=full_commit_sha
docker login ghcr.io
docker pull "$GHCR_IMAGE_PREFIX-frontend:$TASKFLOW_IMAGE_TAG"
docker pull "$GHCR_IMAGE_PREFIX-api:$TASKFLOW_IMAGE_TAG"
docker pull "$GHCR_IMAGE_PREFIX-worker:$TASKFLOW_IMAGE_TAG"
docker pull "$GHCR_IMAGE_PREFIX-dispatcher:$TASKFLOW_IMAGE_TAG"
```

For private GHCR packages, authenticate with a GitHub identity that has package read access. Package visibility and access can be managed in the repository's GitHub Packages settings.

### Production Compose

The local [`docker-compose.yml`](docker-compose.yml) continues to build from the working tree, so `docker compose up --build -d` remains the local build-and-run command. [`docker-compose.prod.yml`](docker-compose.prod.yml) pulls the four externally published GHCR images and has no build sections. It keeps the same frontend, API, worker, and dispatcher services, health/readiness behavior, runtime settings, and restart policies. Neon PostgreSQL and Upstash Redis remain external; no database or Redis containers are defined.

Production Compose needs `GHCR_IMAGE_PREFIX=ghcr.io/<owner>/<repository>` and may use `TASKFLOW_IMAGE_TAG=<full-commit-sha>` (defaults to `latest`). It also requires runtime `DATABASE_URL`, `REDIS_URL`, and `JWT_SECRET`; set `CLIENT_URL` to the public frontend origin. `FRONTEND_PORT` and the same optional retry, worker, dispatcher, queue, and shutdown settings documented above can also be supplied through the shell or an untracked root `.env` file. Never commit that file or put credentials in Compose/workflow definitions.

After setting these values and logging in to GHCR if the packages are private, use:

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f api worker dispatcher
```

This milestone prepares CI and image publishing only. Selecting a hosting provider, configuring its secrets/networking, and deploying the images remain a separate next milestone.

## TaskFlow background jobs

The API and worker run as separate processes. Configure `DATABASE_URL`, `JWT_SECRET`, and `REDIS_URL` in `server/.env` (copy `server/.env.example` and fill in local values). Start Redis separately; for local development, run `redis-server` and use `REDIS_URL=redis://localhost:6379`.

Run the API with `npm run server:dev` and the worker in a second terminal with `npm run server:worker:dev`. Production builds use `npm run server:build`, then start the API with `npm --prefix server start` and the worker with `npm run server:worker`.

Supported demo job types are `email`, `report`, and `data-processing`; handlers return demonstration results without contacting external services. PostgreSQL is the source of truth for job status and results. New BullMQ jobs get three attempts by default with exponential backoff starting at one second (approximately 1s, then 2s between attempts). Set `JOB_ATTEMPTS` and `JOB_BACKOFF_DELAY_MS` in `server/.env` to change the per-job defaults. PostgreSQL `attempts` counts actual handler starts across automatic and manual retries. An error remains visible while a retry is pending; the final failure sets status to `failed` and records `completed_at`.

Failed jobs remain in the existing Jobs list under the **Failed jobs** filter. Retry is owner-scoped, accepts only failed database rows, reuses the existing BullMQ job ID, and resets BullMQ's per-cycle retry counter; PostgreSQL's attempt count remains cumulative. Concurrent retry requests cannot queue duplicate jobs. The demo handlers accept `{"failuresBeforeSuccess":1}` to simulate a transient failure or `{"simulateFailure":true}` to simulate a permanent failure; both are local demo behavior and do not call external services.

### Idempotent job creation

`POST /api/v1/jobs` optionally accepts an `Idempotency-Key` header (1–255 characters), scoped to the authenticated user. The same key with the same type, priority, and JSON payload returns the existing job with HTTP 200 and does not create another outbox event. Reusing that key with different input returns HTTP 409. Requests without the header keep the existing create behavior. The database unique index on `(user_id, idempotency_key)` provides concurrency protection; the nullable key column leaves older jobs unaffected.

The API tests use a database mock for these HTTP cases. The real PostgreSQL concurrency integration test runs only when a dedicated `TEST_DATABASE_URL` points to a disposable test database with the TaskFlow schema and idempotency migration applied. It creates and deletes its own test user. Set it in PowerShell with `$env:TEST_DATABASE_URL = "postgresql://..."` before `npm run server:test`. No dedicated test database is configured in the current environment, so the integration test is skipped and the unique-index concurrency guarantee needs live verification against a test database before deployment.

PostgreSQL and Redis do not share a transaction. Job acceptance is protected by the outbox transaction described below: Redis failure leaves a retryable outbox event, while the API returns the persisted job and dispatcher recovers delivery. Queue dispatch is eventually consistent, so run the dispatcher alongside the API and worker.

### Observability and operations

- `GET /health` is an inexpensive liveness check and returns a request ID in `X-Request-ID`.
- `GET /ready` checks PostgreSQL and Redis reachability and reports whether a worker heartbeat is active. It returns HTTP 503 if the API's required dependencies are unavailable. Worker offline status is reported separately.
- Authenticated `GET /api/v1/metrics` returns safe BullMQ waiting/active/delayed/completed/failed counts and worker processed/success/failure/retry/duration counters. It does not return job payloads. Use the same signed-in session cookie as the jobs API.
- The worker refreshes `taskflow:worker:heartbeat` in Redis every 10 seconds with a 30-second expiry; a stopped worker is consequently reported offline after the key expires. The dashboard displays queue counts, worker status, counters, and its last successful refresh time.
- API and worker logs use a small structured logger. Production output is JSON; development output is readable. HTTP access logs include method, path, status, duration, request ID, and authenticated user ID, never request headers or bodies.
- Existing `started_at` and `completed_at` columns support duration calculations without extra timing columns. Metrics include process-lifetime worker counters and live BullMQ queue counts.
- The dispatcher checks for PostgreSQL jobs left `active` longer than `JOB_STALE_TIMEOUT_MS` (default 600000 ms / 10 minutes). It locks stale rows with `FOR UPDATE SKIP LOCKED`, then reconciles them with their existing BullMQ job ID/state. Jobs still active in BullMQ are left to BullMQ's stalled-job handling, avoiding interruption of genuinely long-running work. Missing jobs are re-enqueued with the same ID, preserving cumulative attempts; exhausted jobs are marked failed. `/api/v1/metrics` and the dashboard include stale detected/recovered/failure counters, stored in Redis.
- For an active BullMQ job, recovery checks the BullMQ lock key. A live lock protects long-running work. If the lock is missing, the dispatcher invokes BullMQ's own stalled-job script, which atomically rechecks the lock and enforces `WORKER_MAX_STALLED_COUNT`; PostgreSQL is reconciled only after BullMQ moves or finishes that same job. Lock/stalled timing defaults are `WORKER_LOCK_DURATION_MS=30000` and `WORKER_STALLED_INTERVAL_MS=30000`.
- Run `server/sql/stale-recovery-schema.sql` once in Neon after `jobs-schema.sql`; it adds `attempts_in_cycle`, which resets only when a manual retry starts while `attempts` remains cumulative. Configure the stale threshold with `JOB_STALE_TIMEOUT_MS` in `server/.env` (default 600000).
- A deterministic non-production crash demo is available only when `TASKFLOW_ENABLE_DEMO_CRASH_HOLD=true` and `NODE_ENV` is not `production`. Submit any supported job with `{"demoCrashHoldFirstAttempt":true}`; the first PostgreSQL attempt stays active until that worker is force-stopped, while its next attempt proceeds normally. Keep this opt-in disabled outside a disposable demo environment.

### Reliable job dispatch (Outbox Pattern)

Job creation now commits the `jobs` row and its `job.dispatch` event together in one PostgreSQL transaction. A separate dispatcher claims available outbox events with `FOR UPDATE SKIP LOCKED`, then enqueues them in BullMQ using the PostgreSQL job UUID as `jobId`. The API no longer relies on Redis being reachable to preserve a newly accepted job: if it crashes after commit, the outbox event remains available for the dispatcher.

After enqueue succeeds, the dispatcher marks the event processed. If it crashes after enqueue but before that update, the claim becomes stale and can be retried; BullMQ's stable job ID prevents a duplicate active queue entry, and the worker still checks PostgreSQL job state before processing. Redis failures move the event to retryable `failed` status with exponential backoff. A later successful dispatch clears the last error. Automatic BullMQ retries are unchanged. Manual retry continues to reuse/retry its existing BullMQ ID directly and does not create a second outbox event.

Apply `server/sql/outbox-schema.sql` manually in Neon after `schema.sql` and `jobs-schema.sql` have been applied. It creates the outbox table/indexes and safely adds dispatch events for existing waiting/delayed jobs; it does not delete or alter existing jobs. The dashboard and authenticated `/api/v1/metrics` include outbox state, attempt/failure totals, and dispatcher heartbeat status.

Run the dispatcher in its own terminal with `npm run server:dispatcher:dev` (production: `npm run server:dispatcher` after `npm run server:build`). It requires the same `DATABASE_URL` and `REDIS_URL` as the API/worker. Optional settings are `DISPATCHER_POLL_INTERVAL_MS` (default 1000), `DISPATCHER_BATCH_SIZE` (20, maximum 100), `OUTBOX_CLAIM_TIMEOUT_MS` (60000), `OUTBOX_RETRY_BASE_MS` (1000), and `OUTBOX_RETRY_MAX_MS` (300000). Start Redis, PostgreSQL, API, worker, and dispatcher for local end-to-end processing. Run unit coverage with `npm run server:test`; PostgreSQL claim/idempotency integration cases need `TEST_DATABASE_URL` pointed at a disposable database with the schema and outbox migration applied, and skip explicitly when it is absent.

Run local checks with `npm run server:test`, `npm run server:build`, `npm run build`, and `npm run lint`. For live readiness and metrics, run Redis, PostgreSQL, API, and worker using the commands above, sign in, then visit `/health`, `/ready`, and `/api/v1/metrics` (metrics requires the authenticated session).

### Verify retries

Start Redis, the API, worker, dispatcher, and frontend in separate terminals:

```powershell
redis-server
npm run server:dev
npm run server:worker:dev
npm run server:dispatcher:dev
npm run dev
```

Sign in and create a `report` job with payload `{"failuresBeforeSuccess":1,"simulatedError":"temporary demo failure"}`. Open its details: it should briefly show a retry-pending state, then complete on the second attempt with a result and attempt count of 2. Create another report with `{"simulateFailure":true,"simulatedError":"permanent demo failure"}`; after three attempts it should appear under **Failed jobs**, show its final error, and offer **Retry**. Retry it and confirm it reuses the same job ID and starts another three-attempt cycle. Try to retry a non-failed job and try another account's failed job; the API should reject both.

Run checks from the project root with `npm run server:test`, `npm run server:build`, `npm run build`, and `npm run lint`.

## Lifecycle, submission limits, and queue pressure

The API, worker, and Outbox dispatcher handle `SIGINT` and `SIGTERM` with idempotent graceful shutdown. The API stops accepting connections, the worker pauses fetching and drains active jobs, and the dispatcher finishes its current recovery/dispatch pass. After `SHUTDOWN_GRACE_PERIOD_MS` expires (default `30000`), a structured timeout/forced-shutdown event is logged; BullMQ lock expiry and the existing stale-job recovery remain responsible for jobs interrupted by a forced worker stop.

`POST /api/v1/jobs` has a distributed Redis fixed-window rate limit scoped to the authenticated user. Defaults are `JOB_SUBMISSION_RATE_LIMIT=60` requests per `JOB_SUBMISSION_RATE_WINDOW_MS=60000` window. It returns `429` plus `RateLimit-*` and `Retry-After` headers when exceeded. If Redis cannot enforce the limit, the API fails closed with `503`.

Queue backpressure returns `503` (`QUEUE_BACKPRESSURE`) with `Retry-After` when BullMQ waiting jobs or total pending work reaches capacity. Total pending work includes waiting/active/delayed BullMQ jobs and pending/processing/retryable Outbox rows, so work not yet dispatched is counted too. API instances serialize admission through a transaction-scoped PostgreSQL advisory lock; job creation and its Outbox event remain atomic. An existing matching idempotent replay is returned before capacity evaluation and does not add queue work. Configure thresholds with `QUEUE_MAX_WAITING_JOBS=10000`, `QUEUE_MAX_PENDING_JOBS=20000`, and `QUEUE_BACKPRESSURE_RETRY_AFTER_SECONDS=5`.

The authenticated `/api/v1/metrics` endpoint includes current queue pressure, rate-limit/backpressure rejection counters, and API/worker shutdown status. These counters are aggregate operational data and do not include job payloads. Existing `/health` and `/ready` probes are not rate-limited. Structured lifecycle and rejection logs omit credentials and request authorization data.

For local verification, run API, worker, dispatcher, Redis, and PostgreSQL as documented above, sign in, and submit jobs to `/api/v1/jobs`. To inspect the 429 path, temporarily set a small `JOB_SUBMISSION_RATE_LIMIT` in a local environment and submit repeatedly as one user; use a second user to confirm the quota is isolated. To inspect `QUEUE_BACKPRESSURE`, use a disposable local environment and temporarily lower `QUEUE_MAX_WAITING_JOBS`/`QUEUE_MAX_PENDING_JOBS`; verify the endpoint recovers after the queue drains. Do not use stress or threshold-lowering checks against production.

### Benchmarking

Run the bounded HTTP submission benchmark against localhost (default 100 jobs, concurrency 5):

```powershell
$env:TASKFLOW_EMAIL = "load-test-user@example.test"
$env:TASKFLOW_PASSWORD = "your-local-test-password"
npm run server:load-test -- --jobs 500 --concurrency 10
```

Append `--dry-run` to print the parsed target and workload without logging in or submitting jobs.

The script reads `TASKFLOW_EMAIL` and `TASKFLOW_PASSWORD` from the environment or `server/.env`; it never prints credentials or cookies. `--base-url` selects the target (defaults to `http://localhost:5000`); remote hosts require `--allow-remote`, which should be used only for a dedicated non-production target. `--jobs` accepts 1–2000, `--concurrency` accepts 1–50, `--type` accepts `email`, `report`, or `data-processing`, and `--wait` also polls submitted jobs through completion up to `--timeout-seconds` (default 300, maximum 3600). Use a test account; the tool defaults to localhost and caps workload size. Unique idempotency keys are generated per request.

Submission results report request count, accepted submissions, failures, wall duration, requests/second, mean latency, and nearest-rank p50/p95/p99 latencies. With `--wait`, the report also includes completed/failed jobs, retries inferred from attempt counts, observed worker drain time, completed jobs/second, and worker concurrency read from the live Redis heartbeat. The wait benchmark refuses to submit if that heartbeat is offline or lacks a valid concurrency value. Configure worker concurrency by setting `WORKER_CONCURRENCY` (default 5, capped at 100) before starting the worker; run identical workloads at values such as 1, 5, 10, and 20 to compare. These are measurements from the target environment, not expected performance guarantees. Compare runs only with the same host, database/Redis, job type, worker count, and similar background load. `--wait` includes polling/API overhead in its processing window.

The `TEST_DATABASE_URL` integration suite exercises 20 concurrent HTTP requests with one idempotency key (one database row and outbox event, duplicate responses reuse the same job) and 20 concurrent submissions with distinct keys (all rows and outbox events are present). It also checks that two PostgreSQL dispatchers cannot claim the same outbox event. Without `TEST_DATABASE_URL`, these PostgreSQL concurrency checks are explicitly skipped. Point it only at a disposable test database with the TaskFlow schema, idempotency index, and outbox migration applied; the tests create and delete test users and jobs.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
