# TaskFlow Deployment

## Production architecture

TaskFlow runs as four Railway services:

  Service                 Role
  ----------------------- --------------------------------------------
  `taskflow`              Express API
  `upbeat-motivation`     BullMQ worker
  `taskflow-dispatcher`   PostgreSQL outbox dispatcher
  `taskflow-frontend`     React/Vite static frontend served by Nginx

External managed dependencies:

-   Neon PostgreSQL
-   Upstash Redis

## API

Railway builds the backend from:

``` text
/server
```

The API listens on Railway's assigned `PORT`.

Healthcheck:

``` text
/health
```

Readiness:

``` text
/ready
```

## Worker

The worker uses the backend image and runs:

``` bash
npm run worker
```

which starts the compiled worker process.

## Dispatcher

The dispatcher uses the backend image and runs:

``` bash
npm run dispatcher
```

It polls the PostgreSQL outbox and publishes jobs to BullMQ.

## Frontend

The frontend is built with Vite and served through unprivileged Nginx.

Nginx:

-   serves the SPA
-   provides `/health`
-   proxies `/api/*` to the API

For Railway's public API upstream, the proxy preserves the API hostname
and enables TLS SNI so Railway ingress can route the request correctly.

## CI/CD

GitHub Actions validates the repository and publishes container images
to GitHub Container Registry.

The production deployment is connected to the GitHub repository so
pushed changes can trigger Railway deployments.

## Environment variables

Secrets are intentionally not documented with their values.

Typical configuration includes:

``` text
DATABASE_URL
REDIS_URL
JWT_SECRET

JOB_ATTEMPTS
JOB_BACKOFF_DELAY_MS

SHUTDOWN_GRACE_PERIOD_MS

JOB_SUBMISSION_RATE_LIMIT
JOB_SUBMISSION_RATE_WINDOW_MS

QUEUE_MAX_WAITING_JOBS
QUEUE_MAX_PENDING_JOBS
QUEUE_BACKPRESSURE_RETRY_AFTER_SECONDS

JOB_STALE_TIMEOUT_MS
TASKFLOW_ENABLE_DEMO_CRASH_HOLD
```

Use the repository's environment configuration and Railway variables for
actual secret values.

## Deployment verification

After deployment:

1.  Open the frontend.
2.  Log in.
3.  Refresh while authenticated.
4.  Create a job.
5.  Confirm it completes.
6.  Check Queue Stats.
7.  Check API `/health`.
8.  Check API `/ready`.
9.  Verify worker and dispatcher are running.
10. Verify logs show no repeated dependency/recovery errors.

## Important production proxy detail

The frontend Nginx configuration uses:

``` nginx
proxy_set_header Host $proxy_host;
proxy_ssl_server_name on;
proxy_ssl_name $proxy_host;
```

when using the Railway public API hostname as the upstream.

This is important because forwarding the frontend hostname to Railway's
API ingress can result in a request that never reaches the intended API
service.
