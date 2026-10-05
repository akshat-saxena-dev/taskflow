import { useEffect, useState } from 'react';
import type { DashboardStats, Job } from '../types/job';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { PriorityBadge } from '../components/PriorityBadge';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import type { OperationalMetrics } from '../services/api';

interface DashboardPageProps {
  onSelectJob: (jobId: string) => void;
  onNavigateToJobs: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ onSelectJob, onNavigateToJobs }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [operations, setOperations] = useState<OperationalMetrics | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [statsData, jobsData, operationsData] = await Promise.all([
        api.getDashboardStats(),
        api.getJobs(),
        api.getOperationalMetrics().catch(() => null)
      ]);
      setStats(statsData);
      setOperations(operationsData);
      setLastRefresh(new Date());
      // Take up to 5 most recent jobs
      setRecentJobs(jobsData.slice(0, 5));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [statsData, jobsData, operationsData] = await Promise.all([
          api.getDashboardStats(),
          api.getJobs(),
          api.getOperationalMetrics().catch(() => null)
        ]);
        if (isMounted) {
          setStats(statsData);
          setRecentJobs(jobsData.slice(0, 5));
          setOperations(operationsData);
          setLastRefresh(new Date());
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void fetchData();

    return () => {
      isMounted = false;
    };
  }, []);

  if (loading) {
    return <LoadingState message="Loading dashboard metrics..." />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadData} />;
  }

  return (
    <div className="tf-page">
      <div className="tf-page-header">
        <div>
          <h1 className="tf-page-title">Dashboard</h1>
          <p className="tf-page-subtitle">Real-time overview of background job distribution and health</p>
        </div>
        <button className="tf-btn-secondary" onClick={loadData}>
          Refresh
        </button>
      </div>

      {stats && (
        <div className="tf-stats-grid">
          <div className="tf-stat-card">
            <span className="tf-stat-label">Total Jobs</span>
            <span className="tf-stat-value">{stats.total}</span>
          </div>
          <div className="tf-stat-card tf-stat-waiting">
            <span className="tf-stat-label">Waiting</span>
            <span className="tf-stat-value">{stats.waiting}</span>
          </div>
          <div className="tf-stat-card tf-stat-active">
            <span className="tf-stat-label">Active</span>
            <span className="tf-stat-value">{stats.active}</span>
          </div>
          <div className="tf-stat-card tf-stat-completed">
            <span className="tf-stat-label">Completed</span>
            <span className="tf-stat-value">{stats.completed}</span>
          </div>
          <div className="tf-stat-card tf-stat-failed">
            <span className="tf-stat-label">Failed</span>
            <span className="tf-stat-value">{stats.failed}</span>
          </div>
        </div>
      )}

      {operations && <div className="tf-card" style={{ marginTop: '24px', padding: '20px' }}>
        <div className="tf-card-header"><h2 className="tf-card-title">System health</h2><span className="tf-muted-text">Last refresh: {lastRefresh?.toLocaleTimeString()}</span></div>
        <div className="tf-stats-grid">
          {(['waiting', 'active', 'delayed', 'completed', 'failed'] as const).map((key) => <div className="tf-stat-card" key={key}><span className="tf-stat-label">Queue {key}</span><span className="tf-stat-value">{operations.queue[key]}</span></div>)}
          <div className="tf-stat-card"><span className="tf-stat-label">Worker</span><span className="tf-stat-value">{operations.worker.alive ? 'Online' : 'Offline'}</span></div>
          <div className="tf-stat-card"><span className="tf-stat-label">Jobs processed</span><span className="tf-stat-value">{operations.worker.processed ?? 0}</span></div>
          <div className="tf-stat-card"><span className="tf-stat-label">Retries</span><span className="tf-stat-value">{operations.worker.retries ?? 0}</span></div>
          <div className="tf-stat-card"><span className="tf-stat-label">Avg processing</span><span className="tf-stat-value">{operations.worker.processed ? `${Math.round((operations.worker.totalDurationMs ?? 0) / operations.worker.processed)} ms` : '—'}</span></div>
          <div className="tf-stat-card"><span className="tf-stat-label">Queue pressure</span><span className="tf-stat-value">{operations.pressure ? `${operations.pressure.pending} / ${operations.pressure.maxPending}` : '—'}</span></div>
        </div>
        <p className="tf-muted-text" style={{ marginTop: '16px' }}>
          Dispatcher: {operations.dispatcher.alive ? 'Online' : 'Offline'} · API: {operations.shutdown?.api ? 'Shutting down' : 'Running'} · Outbox pending: {operations.outbox.pending} · Processing: {operations.outbox.processing} · Failed: {operations.outbox.failed} · Processed: {operations.outbox.processed} · Dispatch failures: {operations.outbox.dispatchFailures}
        </p>
        <p className="tf-muted-text">Stale job recovery: {operations.recovery.recovered} recovered · {operations.recovery.failures} recovery failures · {operations.recovery.detected} detected · Rate limited: {operations.submissionRejections?.rateLimited ?? 0} · Backpressure rejected: {operations.submissionRejections?.backpressure ?? 0}</p>
      </div>}

      <div className="tf-card" style={{ marginTop: '24px' }}>
        <div className="tf-card-header">
          <h2 className="tf-card-title">Recent Jobs</h2>
          <button className="tf-btn-link" onClick={onNavigateToJobs}>
            View all jobs &rarr;
          </button>
        </div>

        {recentJobs.length === 0 ? (
          <EmptyState title="No recent jobs" description="No background jobs have been scheduled yet." />
        ) : (
          <div className="tf-table-wrapper">
            <table className="tf-table">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={() => onSelectJob(job.id)}
                    className="tf-clickable-row"
                  >
                    <td>
                      <span className="tf-mono-tag">{job.id}</span>
                    </td>
                    <td>
                      <span className="tf-job-type">{job.type}</span>
                    </td>
                    <td>
                      <PriorityBadge priority={job.priority} />
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="tf-muted-text">
                      {new Date(job.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td>
                      <button
                        className="tf-btn-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectJob(job.id);
                        }}
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
