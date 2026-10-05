# TaskFlow Load Testing

TaskFlow includes a repeatable load-test script:

``` text
server/scripts/load-test.mjs
```

Example:

``` bash
npm run server:load-test -- --jobs 500 --concurrency 10
```

A dry run is also available:

``` bash
npm run server:load-test -- --jobs 500 --concurrency 10 --dry-run
```

## Metrics

The load test reports:

-   total submitted jobs
-   failed submissions
-   submission duration
-   submission throughput
-   average request latency
-   p50 latency
-   p95 latency
-   p99 latency
-   total processing duration
-   processing throughput
-   worker concurrency

## Benchmark results

The following 500-job runs were recorded in the deployed TaskFlow
environment.

### Concurrency 5

``` text
Jobs:                 500
Submitted:            500
Failures:             0
Submission time:      12232.7 ms
Submission throughput: 40.87 req/s
Average latency:      242.99 ms
P50:                  208.30 ms
P95:                  314.54 ms
P99:                  1114 ms
Processing time:      48058 ms
Processing throughput:10.40 jobs/s
```

### Concurrency 10

``` text
Jobs:                 500
Submitted:            500
Failures:             0
Submission time:      12085.92 ms
Submission throughput:41.37 req/s
Average latency:      239.31 ms
P50:                  200.27 ms
P95:                  393.15 ms
P99:                  1126.69 ms
Processing time:      13924 ms
Processing throughput:35.91 jobs/s
```

### Concurrency 20

``` text
Jobs:                 500
Submitted:            500
Failures:             0
Submission time:      12764.83 ms
Submission throughput:39.17 req/s
Average latency:      253.78 ms
P50:                  210.62 ms
P95:                  373.18 ms
P99:                  1250.72 ms
Processing time:      8379 ms
Processing throughput:59.67 jobs/s
```

## Interpretation

Increasing worker concurrency improved job processing throughput:

``` text
5 workers  -> 10.40 jobs/s
10 workers -> 35.91 jobs/s
20 workers -> 59.67 jobs/s
```

The improvement is not perfectly linear because worker concurrency is
only one part of the system. Database writes, Redis operations, queue
coordination, CPU, and simulated handler execution can become
bottlenecks.

Submission throughput remained around 40 requests/s in these runs,
showing that the HTTP submission path and background processing path
have different bottlenecks.

## Result quality

All three benchmark runs completed:

``` text
500 / 500 jobs
0 failures
0 retries
0 timeouts
```

These results should be treated as environment-specific measurements
rather than universal capacity guarantees.
