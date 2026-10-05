# TaskFlow Reliability

TaskFlow's main engineering goal is reliable asynchronous execution
under failure.

## Idempotency

A client may retry a request because of a timeout or lost response.

Without idempotency:

``` text
Request 1 -> job A
Request 1 retried -> job B
```

With TaskFlow:

``` text
Request + Idempotency-Key
        |
        v
(user_id, idempotency_key)
        |
        +-- existing -> return existing job
        |
        +-- missing  -> create job + outbox event
```

The uniqueness rule is enforced in PostgreSQL.

## Transactional Outbox

A naive implementation might do:

``` text
INSERT job
   |
   +-- publish queue message
```

A crash between those operations can leave:

``` text
Database: job exists
Queue:    no message
```

TaskFlow instead does:

``` text
BEGIN
  INSERT job
  INSERT outbox event
COMMIT
```

The dispatcher later converts the durable event into a BullMQ job.

## Retry model

The default job execution configuration uses three attempts with
exponential backoff.

``` text
Attempt 1
   |
   | failure
   v
Backoff
   |
   v
Attempt 2
   |
   | failure
   v
Backoff
   |
   v
Attempt 3
   |
   +---- success -> Completed
   |
   +---- failure -> Failed
```

Manual retry can be performed for a failed job, with cumulative attempt
tracking preserved.

## Worker crash recovery

A worker process can disappear while a job is active.

TaskFlow uses:

-   BullMQ lock/stalled-job behavior
-   PostgreSQL stale-job detection
-   lock-aware recovery
-   `attempts_in_cycle`
-   stale-claim recovery
-   safe re-enqueueing

The recovery logic avoids immediately re-enqueuing a job that still has
a valid active BullMQ lock.

## Rate limiting

Submission is limited per user using Redis.

When the configured window is exhausted:

``` text
HTTP 429
RATE_LIMITED
Retry-After: <seconds>
```

The limiter is designed to fail closed when Redis is unavailable rather
than allowing unlimited submissions during a dependency failure.

## Queue backpressure

A system can be technically healthy while its queue grows without bound.

TaskFlow therefore applies admission control.

Pressure includes:

-   BullMQ waiting jobs
-   BullMQ active jobs
-   BullMQ delayed jobs
-   pending outbox events
-   processing outbox events
-   retryable outbox events

When configured capacity is exceeded:

``` text
HTTP 503
QUEUE_BACKPRESSURE
Retry-After: 5
```

An advisory lock coordinates capacity admission across API instances.

## Graceful shutdown

Processes respond to SIGINT/SIGTERM.

Workers stop taking new work and drain active work during the shutdown
grace period.

Dispatcher polling is stopped and resources are cleaned up.

This reduces the probability of terminating a process in the middle of
state transitions.

## Outage behavior

### Dispatcher unavailable

``` text
API
 |
 +--> PostgreSQL job
 +--> PostgreSQL outbox event

Dispatcher down

Result:
job remains durable and waiting
```

When the dispatcher returns, it processes the pending event.

### Redis unavailable

Readiness reports Redis as down and queue operations do not silently
pretend that dispatch succeeded.

### Worker unavailable

The API can still accept durable work subject to backpressure. Jobs
remain waiting until worker capacity returns.

## Reliability validation

The production implementation was manually validated for:

-   idempotent replay
-   retry after transient failure
-   terminal permanent failure
-   manual retry
-   outbox recovery while dispatcher was stopped
-   worker crash recovery
-   rate-limit rejection
-   queue backpressure rejection
-   graceful shutdown
