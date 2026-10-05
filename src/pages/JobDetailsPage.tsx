import { useCallback, useEffect, useState } from 'react';
import type { Job, JobStatus } from '../types/job';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { PriorityBadge } from '../components/PriorityBadge';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';

interface JobDetailsPageProps { jobId: string; onBack: () => void; }

const formatDate = (value?: string) => value ? new Date(value).toLocaleString() : '—';

export const JobDetailsPage: React.FC<JobDetailsPageProps> = ({ jobId, onBack }) => {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const loadJob = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setJob(await api.getJobById(jobId));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load job details');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    let mounted = true;
    const fetchJob = async () => {
      try {
        const result = await api.getJobById(jobId);
        if (mounted) setJob(result);
      } catch (err: unknown) {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to load job details');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void fetchJob();
    return () => { mounted = false; };
  }, [jobId]);

  const shouldPollJob = job !== null && ['waiting', 'active', 'delayed'].includes(job.status);
  useEffect(() => {
    if (!shouldPollJob) return;
    let mounted = true;
    const timer = window.setInterval(() => {
      void api.getJobById(jobId).then((nextJob) => {
        if (mounted) { setJob(nextJob); setError(null); }
      }).catch((err: unknown) => {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to refresh job status');
      });
    }, 2000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [shouldPollJob, jobId]);

  const deleteJob = async () => {
    if (!job) return;
    try {
      setDeleting(true);
      await api.deleteJob(job.id);
      onBack();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete job');
    } finally {
      setDeleting(false);
    }
  };

  const retryJob = async () => {
    if (!job) return;
    try {
      setRetrying(true);
      await api.retryJob(job.id);
      await loadJob();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retry job');
    } finally {
      setRetrying(false);
    }
  };

  if (loading) return <LoadingState message={`Fetching details for job ${jobId}...`} />;
  if (error && !job) return <ErrorState message={error} onRetry={() => { void loadJob(); }} />;
  if (!job) return <div className="tf-page"><button className="tf-btn-secondary" onClick={onBack}>← Back</button><EmptyState title="Job not found" description="This job does not exist or is not available to your account." actionText="Back to jobs" onAction={onBack} /></div>;

  return (
    <div className="tf-page">
      <header className="tf-page-header">
        <div className="tf-detail-heading">
          <button type="button" className="tf-btn-link" onClick={onBack}>← Back to jobs</button>
          <div className="tf-detail-title-row">
            <h1 className="tf-detail-id">{job.id}</h1>
            <StatusBadge status={job.status as JobStatus} />
            <PriorityBadge priority={job.priority} />
          </div>
          <p className="tf-page-subtitle">Job type <strong>{job.type}</strong> <span aria-hidden="true">·</span> Queue <strong>{job.queue}</strong></p>
        </div>
        <div className="tf-actions-row tf-detail-actions">
          <button type="button" className="tf-btn-secondary" onClick={() => { void loadJob(); }} disabled={loading}>Refresh</button>
          {job.status === 'failed' && <button type="button" className="tf-btn-primary" onClick={() => { void retryJob(); }} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry job'}</button>}
          {job.status !== 'active' && <button type="button" className="tf-btn-danger" onClick={deleteJob} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete job'}</button>}
        </div>
      </header>
      {error && <p role="alert" className="tf-error-text">{error}</p>}

      <section className="tf-lifecycle" aria-label="Job lifecycle timestamps">
        <div className="tf-lifecycle-step"><span>Created</span><strong>{formatDate(job.createdAt)}</strong></div>
        <div className="tf-lifecycle-step"><span>Started</span><strong>{formatDate(job.startedAt)}</strong></div>
        <div className="tf-lifecycle-step"><span>Completed</span><strong>{formatDate(job.completedAt)}</strong></div>
        <div className="tf-lifecycle-step"><span>Attempts</span><strong>{job.attempts}</strong></div>
      </section>

      <div className="tf-details-grid">
        <section className="tf-card" aria-labelledby="job-info-title">
          <h2 className="tf-card-title" id="job-info-title">Job information</h2>
          <dl className="tf-keyvalue-list">
            <div className="tf-keyvalue-item"><dt className="tf-key">Updated</dt><dd className="tf-value">{formatDate(job.updatedAt)}</dd></div>
            <div className="tf-keyvalue-item"><dt className="tf-key">Failed</dt><dd className="tf-value">{formatDate(job.failedAt)}</dd></div>
            <div className="tf-keyvalue-item"><dt className="tf-key">Maximum attempts</dt><dd className="tf-value">{job.maxAttempts || '—'}</dd></div>
            <div className="tf-keyvalue-item"><dt className="tf-key">Queue</dt><dd className="tf-value">{job.queue}</dd></div>
          </dl>
        </section>
        <section className="tf-card" aria-labelledby="job-result-title">
          <h2 className="tf-card-title" id="job-result-title">{job.error ? 'Failure details' : 'Result'}</h2>
          {job.error ? <pre className="tf-code-block is-error">{job.error}</pre> : job.result ? <pre className="tf-code-block">{JSON.stringify(job.result, null, 2)}</pre> : <div className="tf-pending-box">No result is available for this job yet.</div>}
        </section>
      </div>
      <section className="tf-card tf-payload-card" aria-labelledby="job-payload-title">
        <h2 className="tf-card-title" id="job-payload-title">Job payload</h2>
        <pre className="tf-code-block">{JSON.stringify(job.payload, null, 2)}</pre>
      </section>
    </div>
  );
};
