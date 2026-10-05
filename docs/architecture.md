# TaskFlow Architecture

## 1. System overview

TaskFlow separates request handling from asynchronous job execution.

The API is responsible for authentication, validation, persistence,
admission control, and observability. It does not perform the
long-running job itself.

The dispatcher bridges durable PostgreSQL outbox events and
BullMQ/Redis. Workers consume BullMQ jobs and update PostgreSQL with
execution state.

``` mermaid
flowchart LR
    Client --> Frontend
    Frontend --> API
    API --> PostgreSQL
    API --> Redis
    PostgreSQL --> Outbox
    Outbox --> Dispatcher
    Dispatcher --> Redis
    Redis --> BullMQ
    BullMQ --> Worker
    Worker --> PostgreSQL
```

## 2. Why PostgreSQL is the source of durable job state

PostgreSQL stores the authoritative job record:

-   job ID
-   user ID
-   type
-   payload
-   status
-   attempts
-   timestamps
-   result
-   error
-   idempotency key
-   recovery state

Redis/BullMQ is used for asynchronous delivery and execution
coordination, not as the only durable record of application state.

## 3. Transactional job creation

The critical write path is:

``` mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant P as PostgreSQL
    participant D as Dispatcher
    participant R as Redis
    participant W as Worker

    C->>A: POST /api/v1/jobs
    A->>P: BEGIN
    A->>P: INSERT job
    A->>P: INSERT job.dispatch outbox event
    A->>P: COMMIT
    A-->>C: 201 Created
    D->>P: Claim outbox event
    D->>R: Add BullMQ job
    D->>P: Mark event processed
    W->>R: Consume job
    W->>P: Update job status/result
```

If the API process crashes after commit but before dispatch, the outbox
event remains durable and the dispatcher can finish the delivery later.

## 4. Dispatcher concurrency

Outbox rows are claimed using PostgreSQL row locking with
`FOR UPDATE SKIP LOCKED`.

This lets multiple dispatcher instances safely work in parallel without
waiting for already-claimed rows.

A stable BullMQ job ID is used so repeated dispatch attempts do not
create uncontrolled duplicate queue entries.

## 5. Worker execution

Workers are independent processes.

A worker:

1.  receives a BullMQ job
2.  loads/executes the task handler
3.  records execution state
4.  records result or error
5.  allows BullMQ retry behavior to handle retryable execution failures

Workers can be scaled independently from the API.

## 6. Failure boundaries

``` text
API crash before transaction commit
    -> no durable job is created

API crash after transaction commit
    -> outbox event remains and dispatcher recovers it

Dispatcher crash
    -> unprocessed outbox event remains

Worker crash
    -> BullMQ lock/stalled handling + PostgreSQL stale-job recovery reconcile state

Redis outage
    -> readiness and queue operations fail safely rather than pretending work was dispatched

API overload
    -> rate limiting and queue backpressure reject excess work
```

## 7. Production topology

``` text
                 Railway
┌───────────────────────────────────────────────┐
│                                               │
│  ┌──────────────┐      ┌──────────────┐      │
│  │   Frontend   │─────▶│     API      │      │
│  │ Nginx + SPA  │      │   Express    │      │
│  └──────────────┘      └──────┬───────┘      │
│                               │               │
│                 ┌─────────────┴──────────┐    │
│                 │                        │    │
│            ┌────▼─────┐             ┌────▼──┐ │
│            │  Worker  │             │Dispatcher│
│            └────┬─────┘             └────┬──┘ │
│                 │                        │    │
└─────────────────┼────────────────────────┼────┘
                  │                        │
          ┌───────▼────────┐       ┌──────▼─────┐
          │ Neon PostgreSQL│       │ Upstash Redis│
          └────────────────┘       └─────────────┘
```
