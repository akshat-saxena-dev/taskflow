import { useEffect, useState, useCallback, useRef } from 'react';
import type { Job, JobStatus } from '../types/job';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { PriorityBadge } from '../components/PriorityBadge';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';

interface JobsPageProps {
  onSelectJob: (jobId: string) => void;
}

export const JobsPage: React.FC<JobsPageProps> = ({ onSelectJob }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [totalJobs, setTotalJobs] = useState(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [jobType, setJobType] = useState('');
  const [payloadText, setPayloadText] = useState('{}');
  const [priority, setPriority] = useState('normal');
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const createAttempt = useRef<{ signature: string; key: string } | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getJobPage({ status: statusFilter, page, limit: 20 });
      setJobs(data.jobs);
      setPageCount(data.pagination.totalPages);
      setTotalJobs(data.pagination.total);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getJobPage({ status: statusFilter, page, limit: 20 });
        if (isMounted) {
          setJobs(data.jobs);
          setPageCount(data.pagination.totalPages);
          setTotalJobs(data.pagination.total);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch jobs');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [statusFilter, page]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      setActionInProgress(id);
      await api.deleteJob(id);
      setActionMessage('Job deleted.');
      await loadJobs();
    } catch (err: unknown) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to delete job');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRetry = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      setActionInProgress(id);
      await api.retryJob(id);
      setActionMessage('Job queued for retry.');
      await loadJobs();
    } catch (err: unknown) {
      setActionMessage(err instanceof Error ? err.message : 'Failed to retry job');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError(null);
    setActionMessage(null);
    try {
      const payload: unknown = JSON.parse(payloadText);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Payload must be a JSON object.');
      }
      const input = { type: jobType, payload: payload as Record<string, unknown>, priority };
      const signature = JSON.stringify(input);
      if (!createAttempt.current || createAttempt.current.signature !== signature) {
        createAttempt.current = { signature, key: crypto.randomUUID() };
      }
      setActionInProgress('create');
      await api.createJob(input, createAttempt.current.key);
      setActionMessage('Job submitted successfully.');
      createAttempt.current = null;
      setJobType('');
      setPayloadText('{}');
      if (page === 1) await loadJobs();
      else setPage(1);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create job');
    } finally {
      setActionInProgress(null);
    }
  };

  const filteredJobs = jobs.filter((job) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      job.id.toLowerCase().includes(query) ||
      job.type.toLowerCase().includes(query)
    );
  });

  return (
    <div className="tf-page">
      <div className="tf-page-header">
        <div>
          <h1 className="tf-page-title">Jobs</h1>
          <p className="tf-page-subtitle">Inspect, filter, and control queued background tasks</p>
        </div>
        <button className="tf-btn-secondary" onClick={loadJobs} disabled={loading}>
          Refresh
        </button>
      </div>

      <form className="tf-card tf-create-form" onSubmit={handleCreate}>
        <h2 className="tf-card-title">Create a job</h2>
        <div className="tf-create-controls">
          <label className="tf-create-field"><span className="tf-filter-label">Job type</span>
          <select className="tf-select" aria-label="Job type" value={jobType} onChange={(e) => setJobType(e.target.value)} required>
            <option value="" disabled>Select a job type</option><option value="email">Email demo</option><option value="report">Report demo</option><option value="data-processing">Data processing demo</option>
          </select>
          </label>
          <label className="tf-create-field"><span className="tf-filter-label">Priority</span>
          <select className="tf-select" aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option><option value="critical">Critical priority</option>
          </select>
          </label>
          <div className="tf-create-field">
          <button className="tf-btn-primary" type="submit" disabled={actionInProgress === 'create'}>{actionInProgress === 'create' ? 'Creating…' : 'Create Job'}</button>
          </div>
        </div>
        <label className="tf-payload-label" htmlFor="job-payload">Payload (JSON object)</label>
        <textarea id="job-payload" className="tf-input" rows={4} value={payloadText} onChange={(e) => setPayloadText(e.target.value)} />
        {createError && <p role="alert" className="tf-error-text">{createError}</p>}
        {actionMessage && <p role="status" className="tf-feedback">{actionMessage}</p>}
      </form>

      <div className="tf-toolbar">
        <div className="tf-filter-group">
          <label htmlFor="status-select" className="tf-filter-label">Status:</label>
          <select
            id="status-select"
            className="tf-select"
            value={statusFilter}
          onChange={(e) => { setPage(1); setStatusFilter(e.target.value); }}
          >
            <option value="all">All Statuses</option>
            <option value="waiting">Waiting</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed jobs</option>
            <option value="delayed">Delayed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="tf-search-group">
          <input
            type="text"
            className="tf-input"
            aria-label="Search jobs by ID or type"
            placeholder="Search by ID or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="tf-btn-clear" onClick={() => setSearchQuery('')}>
              &times;
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingState message="Loading jobs list..." />
      ) : error ? (
        <ErrorState message={error} onRetry={loadJobs} />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          title="No jobs found"
          description={
            searchQuery || statusFilter !== 'all'
              ? 'Try resetting the filter or search query.'
              : 'There are currently no background jobs in the database.'
          }
          actionText={searchQuery || statusFilter !== 'all' ? 'Reset Filters' : undefined}
          onAction={() => {
            setSearchQuery('');
            setStatusFilter('all');
          }}
        />
      ) : (
        <div className="tf-card">
          <div className="tf-table-wrapper">
            <table className="tf-table tf-mobile-table">
              <thead>
                <tr>
                  <th>Job ID</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Attempts</th>
                  <th>Created At</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => {
                  const isProcessing = actionInProgress === job.id;
                  const canDelete = job.status !== 'active';

                  return (
                    <tr
                      key={job.id}
                      className="tf-clickable-row"
                      tabIndex={0}
                      aria-label={`Open job ${job.id}`}
                      onClick={() => onSelectJob(job.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectJob(job.id); } }}
                    >
                      <td data-label="Job ID">
                        <span className="tf-mono-tag">{job.id}</span>
                      </td>
                      <td data-label="Type">
                        <span className="tf-job-type">{job.type}</span>
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={job.status as JobStatus} />
                      </td>
                      <td data-label="Priority">
                        <PriorityBadge priority={job.priority} />
                      </td>
                      <td data-label="Attempts">
                        <span className="tf-mono-text">
                          {job.attempts}
                        </span>
                      </td>
                      <td data-label="Created" className="tf-muted-text">
                        {new Date(job.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </td>
                      <td data-label="Actions" style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                        <div className="tf-actions-row">
                          <button
                            className="tf-btn-xs"
                            onClick={() => onSelectJob(job.id)}
                            title="View details"
                          >
                            Details
                          </button>

                          {job.status === 'failed' && (
                            <button className="tf-btn-xs" onClick={(e) => handleRetry(e, job.id)} disabled={isProcessing}>
                              {isProcessing ? 'Retrying…' : 'Retry'}
                            </button>
                          )}

                          {canDelete && (
                            <button
                              className="tf-btn-xs tf-btn-danger"
                              onClick={(e) => handleDelete(e, job.id)}
                              disabled={isProcessing}
                            >
                              {isProcessing ? '...' : 'Delete'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="tf-card-footer">
            <span>Page {page} of {pageCount} · {totalJobs} jobs</span>
            <div className="tf-actions-row">
              <button className="tf-btn-xs" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading}>Previous</button>
              <button className="tf-btn-xs" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount || loading}>Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
