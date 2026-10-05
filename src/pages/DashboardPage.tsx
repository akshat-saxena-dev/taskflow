import { useCallback, useEffect, useState } from 'react';
import type { DashboardStats, Job } from '../types/job';
import { api, type OperationalMetrics } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { PriorityBadge } from '../components/PriorityBadge';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';

interface DashboardPageProps {
  onSelectJob: (jobId: string) => void;
  onNavigateToJobs: () => void;
}

const formatTime = (value: Date | null) => value?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) ?? '—';

const fetchDashboardData = async () => {
  const [stats, jobs, operations] = await Promise.all([
    api.getDashboardStats(),
    api.getJobs(),
    api.getOperationalMetrics().catch(() => null)
  ]);
  return { stats, jobs, operations };
};

export const DashboardPage: React.FC<DashboardPageProps> = ({ onSelectJob, onNavigateToJobs }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operations, setOperations] = useState<OperationalMetrics | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      setRefreshing(true);
      const { stats: statsData, jobs: jobsData, operations: operationsData } = await fetchDashboardData();
      setStats(statsData);
      setOperations(operationsData);
      setLastRefresh(new Date());
      setRecentJobs(jobsData.slice(0, 5));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const fetchInitialData = async () => {
      try {
        const { stats: statsData, jobs: jobsData, operations: operationsData } = await fetchDashboardData();
        if (mounted) {
          setStats(statsData);
          setOperations(operationsData);
          setLastRefresh(new Date());
          setRecentJobs(jobsData.slice(0, 5));
        }
      } catch (err: unknown) {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void fetchInitialData();
    return () => { mounted = false; };
  }, []);

  if (loading) return <LoadingState message="Loading operational overview..." />;
  if (error) return <ErrorState message={error} onRetry={() => { void loadData(); }} />;

  const overview = [
    { label: 'Total jobs', value: stats?.total ?? 0 },
    { label: 'Waiting', value: stats?.waiting ?? 0, tone: 'waiting' },
    { label: 'Active', value: stats?.active ?? 0, tone: 'active' },
    { label: 'Completed', value: stats?.completed ?? 0, tone: 'completed' },
    { label: 'Failed', value: stats?.failed ?? 0, tone: 'failed' },
    { label: 'Delayed', value: stats?.delayed ?? 0 }
  ];

  return (
    <div className="tf-page">
      <header className="tf-page-header">
        <div>
          <span className="tf-overline">TASKFLOW / OPERATIONS</span>
          <h1 className="tf-page-title">Dashboard</h1>
          <p className="tf-page-subtitle">A current snapshot of job activity and processing health.</p>
        </div>
        <div className="tf-page-header-actions">
          {lastRefresh && <span className="tf-muted-text">Updated {formatTime(lastRefresh)}</span>}
          <button type="button" className="tf-btn-secondary" onClick={() => { void loadData(); }} disabled={refreshing}>
            <span aria-hidden="true">↻</span> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="tf-stats-grid" aria-label="Job totals">
        {overview.map((item) => (
          <article className={`tf-stat-card ${item.tone ? `tf-stat-${item.tone}` : ''}`} key={item.label}>
            <span className="tf-stat-label">{item.label}</span>
            <span className="tf-stat-value">{item.value.toLocaleString()}</span>
          </article>
        ))}
      </section>

      <section className="tf-card tf-dashboard-section" aria-labelledby="health-title">
        <div className="tf-card-header">
          <div><span className="tf-overline">LIVE TELEMETRY</span><h2 className="tf-card-title" id="health-title">System health</h2></div>
          <span className={`tf-health-pill ${operations ? 'is-available' : 'is-unavailable'}`}><span />{operations ? 'Metrics available' : 'Metrics unavailable'}</span>
        </div>
        {operations ? (
          <>
            <div className="tf-system-grid">
              <div className="tf-system-card"><span className="tf-system-label">Queue waiting</span><strong className="tf-system-value">{operations.queue.waiting.toLocaleString()}</strong><span className="tf-system-caption">{operations.queue.active.toLocaleString()} active · {operations.queue.delayed.toLocaleString()} delayed</span></div>
              <div className="tf-system-card"><span className="tf-system-label">Worker processing</span><strong className="tf-system-value">{operations.worker.processed?.toLocaleString() ?? '—'}</strong><span className="tf-system-caption">{operations.worker.active ?? 0} active · {operations.worker.retries ?? 0} retries</span></div>
              <div className="tf-system-card"><span className="tf-system-label">Pending outbox</span><strong className="tf-system-value">{(operations.outbox.pending + operations.outbox.processing).toLocaleString()}</strong><span className="tf-system-caption">{operations.outbox.failed} failed records</span></div>
              <div className="tf-system-card"><span className="tf-system-label">Queue pressure</span><strong className="tf-system-value">{operations.pressure ? `${operations.pressure.pending.toLocaleString()} / ${operations.pressure.maxPending.toLocaleString()}` : '—'}</strong><span className="tf-system-caption">{operations.pressure?.overloaded ? 'Capacity threshold reached' : 'Pending work / configured limit'}</span></div>
            </div>
            <div className="tf-health-line" aria-label="Service status">
              <span className="tf-health-item"><span className={`tf-health-dot ${operations.worker.alive ? 'is-up' : 'is-down'}`} />Worker {operations.worker.alive ? 'online' : 'offline'}</span>
              <span className="tf-health-item"><span className={`tf-health-dot ${operations.dispatcher.alive ? 'is-up' : 'is-down'}`} />Dispatcher {operations.dispatcher.alive ? 'online' : 'offline'}</span>
              <span className="tf-health-item"><span className={`tf-health-dot ${operations.outbox.failed ? 'is-warning' : 'is-up'}`} />Outbox {operations.outbox.failed ? `${operations.outbox.failed} failed` : 'clear'}</span>
              {operations.shutdown?.api && <span className="tf-health-item"><span className="tf-health-dot is-warning" />API shutting down</span>}
            </div>
          </>
        ) : <p className="tf-muted-text">Operational metrics could not be loaded. Job totals above are available separately.</p>}
      </section>

      <section className="tf-card tf-dashboard-section" aria-labelledby="recent-jobs-title">
        <div className="tf-card-header">
          <div><span className="tf-overline">LATEST ACTIVITY</span><h2 className="tf-card-title" id="recent-jobs-title">Recent jobs</h2></div>
          <button type="button" className="tf-btn-link" onClick={onNavigateToJobs}>View all jobs <span aria-hidden="true">→</span></button>
        </div>
        {recentJobs.length === 0 ? <EmptyState title="No jobs yet" description="Jobs submitted to TaskFlow will appear here." /> : (
          <div className="tf-table-wrapper">
            <table className="tf-table tf-mobile-table">
              <thead><tr><th>Job ID</th><th>Type</th><th>Priority</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>
              <tbody>{recentJobs.map((job) => (
                <tr key={job.id} className="tf-clickable-row" onClick={() => onSelectJob(job.id)}>
                  <td data-label="Job ID"><span className="tf-mono-tag">{job.id}</span></td>
                  <td data-label="Type"><span className="tf-job-type">{job.type}</span></td>
                  <td data-label="Priority"><PriorityBadge priority={job.priority} /></td>
                  <td data-label="Status"><StatusBadge status={job.status} /></td>
                  <td data-label="Created"><span className="tf-muted-text">{new Date(job.createdAt).toLocaleString()}</span></td>
                  <td data-label="Action"><button type="button" className="tf-btn-xs" aria-label={`Inspect job ${job.id}`} onClick={(event) => { event.stopPropagation(); onSelectJob(job.id); }}>Inspect details</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
