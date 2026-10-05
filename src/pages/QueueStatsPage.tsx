import { useCallback, useEffect, useState } from 'react';
import { api, type OperationalMetrics } from '../services/api';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';

const count = (value?: number) => (value ?? 0).toLocaleString();

export const QueueStatsPage: React.FC = () => {
  const [stats, setStats] = useState<OperationalMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setStats(await api.getOperationalMetrics());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch operational metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const data = await api.getOperationalMetrics();
        if (mounted) setStats(data);
      } catch (err: unknown) {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to fetch operational metrics');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void fetchStats();
    return () => { mounted = false; };
  }, []);

  if (loading) return <LoadingState message="Loading queue and worker telemetry…" />;
  if (error) return <ErrorState message={error} onRetry={() => { void loadStats(); }} />;
  if (!stats) return null;

  const queueItems = [
    ['Waiting', stats.queue.waiting], ['Active', stats.queue.active], ['Delayed', stats.queue.delayed],
    ['Completed', stats.queue.completed], ['Failed', stats.queue.failed]
  ];
  const pressurePercent = stats.pressure && stats.pressure.maxPending > 0
    ? Math.min(100, Math.round((stats.pressure.pending / stats.pressure.maxPending) * 100)) : null;

  return (
    <div className="tf-page">
      <header className="tf-page-header">
        <div>
          <span className="tf-overline">TASKFLOW / TELEMETRY</span>
          <h1 className="tf-page-title">Queue &amp; worker stats</h1>
          <p className="tf-page-subtitle">Live queue, worker, outbox, and recovery metrics from this TaskFlow deployment.</p>
        </div>
        <div className="tf-page-header-actions">
          <span className="tf-muted-text">Observed {new Date(stats.observedAt).toLocaleTimeString()}</span>
          <button type="button" className="tf-btn-secondary" onClick={() => { void loadStats(); }} disabled={loading}>Refresh</button>
        </div>
      </header>

      <section className="tf-card tf-queue-overview" aria-labelledby="queue-state-title">
        <div className="tf-card-header">
          <div><span className="tf-overline">BULLMQ</span><h2 className="tf-card-title" id="queue-state-title">Queue state</h2></div>
          <span className={`tf-health-pill ${!stats.pressure ? 'is-neutral' : stats.pressure.overloaded ? 'is-unavailable' : 'is-available'}`}><span />{!stats.pressure ? 'Pressure unavailable' : stats.pressure.overloaded ? 'Backpressure active' : 'Accepting work'}</span>
        </div>
        <div className="tf-stats-grid">
          {queueItems.map(([label, value]) => <article className="tf-stat-card" key={label as string}><span className="tf-stat-label">{label}</span><strong className="tf-stat-value">{Number(value).toLocaleString()}</strong></article>)}
        </div>
        {stats.pressure && <div className="tf-pressure-summary">
          <div className="tf-queue-metric-row"><span>Pending against configured limit</span><strong>{count(stats.pressure.pending)} / {count(stats.pressure.maxPending)}</strong></div>
          <div className="tf-pressure-track" role="progressbar" aria-label="Pending queue capacity" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pressurePercent ?? 0}><span style={{ width: `${pressurePercent ?? 0}%` }} /></div>
          <p className="tf-muted-text">Waiting {count(stats.pressure.waiting)} · Rate limited {count(stats.submissionRejections?.rateLimited)} · Backpressure rejections {count(stats.submissionRejections?.backpressure)}</p>
        </div>}
      </section>

      <div className="tf-queue-columns">
        <section className="tf-card" aria-labelledby="worker-title">
          <div className="tf-card-header"><div><span className="tf-overline">PROCESSING</span><h2 className="tf-card-title" id="worker-title">Worker</h2></div><span className={`tf-health-pill ${stats.worker.alive ? 'is-available' : 'is-unavailable'}`}><span />{stats.worker.alive ? 'Online' : 'Offline'}</span></div>
          <div className="tf-queue-metric-row"><span>Processed</span><strong>{count(stats.worker.processed)}</strong></div>
          <div className="tf-queue-metric-row"><span>Succeeded</span><strong>{count(stats.worker.succeeded)}</strong></div>
          <div className="tf-queue-metric-row"><span>Failed</span><strong>{count(stats.worker.failed)}</strong></div>
          <div className="tf-queue-metric-row"><span>Retries</span><strong>{count(stats.worker.retries)}</strong></div>
          <div className="tf-queue-metric-row"><span>Currently active</span><strong>{count(stats.worker.active)}</strong></div>
          {stats.worker.totalDurationMs !== undefined && <div className="tf-queue-metric-row"><span>Total processing time</span><strong>{(stats.worker.totalDurationMs / 1000).toLocaleString()} s</strong></div>}
        </section>
        <section className="tf-card" aria-labelledby="outbox-title">
          <div className="tf-card-header"><div><span className="tf-overline">TRANSACTIONAL OUTBOX</span><h2 className="tf-card-title" id="outbox-title">Dispatch &amp; recovery</h2></div><span className={`tf-health-pill ${stats.dispatcher.alive ? 'is-available' : 'is-unavailable'}`}><span />Dispatcher {stats.dispatcher.alive ? 'online' : 'offline'}</span></div>
          <div className="tf-queue-metric-row"><span>Pending</span><strong>{count(stats.outbox.pending)}</strong></div>
          <div className="tf-queue-metric-row"><span>Processing</span><strong>{count(stats.outbox.processing)}</strong></div>
          <div className="tf-queue-metric-row"><span>Failed / retryable</span><strong>{count(stats.outbox.failed)}</strong></div>
          <div className="tf-queue-metric-row"><span>Dispatched</span><strong>{count(stats.outbox.processed)}</strong></div>
          <div className="tf-queue-metric-row"><span>Dispatch failures</span><strong>{count(stats.outbox.dispatchFailures)}</strong></div>
          <div className="tf-queue-metric-row"><span>Recovery detected / recovered</span><strong>{count(stats.recovery.detected)} / {count(stats.recovery.recovered)}</strong></div>
          <div className="tf-queue-metric-row"><span>Recovery failures</span><strong>{count(stats.recovery.failures)}</strong></div>
        </section>
      </div>
      <p className="tf-metrics-note">Metrics are a point-in-time snapshot. Refresh to request the latest values.</p>
    </div>
  );
};
