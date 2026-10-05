import { useCallback, useEffect, useState } from 'react';
import type { Job, JobStatus } from '../types/job';
import { api } from '../services/api';
import { StatusBadge } from '../components/StatusBadge';
import { PriorityBadge } from '../components/PriorityBadge';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';

interface JobDetailsPageProps { jobId: string; onBack: () => void; }

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
        if (mounted) setJob(nextJob);
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
  if (!job) return <div className="tf-page"><button className="tf-btn-secondary" onClick={onBack}>&larr; Back</button><EmptyState title="Job Not Found" description="This job does not exist or is not available to your account." actionText="Back to Jobs" onAction={onBack} /></div>;

  return (
    <div className="tf-page">
      <div className="tf-page-header">
        <div>
          <button className="tf-btn-link" onClick={onBack} style={{ marginBottom: '8px', padding: 0 }}>&larr; Back to jobs list</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h1 className="tf-page-title">{job.id}</h1>
            <StatusBadge status={job.status as JobStatus} />
            <PriorityBadge priority={job.priority} />
          </div>
          <p className="tf-page-subtitle">Type: <strong>{job.type}</strong></p>
        </div>
        <div className="tf-actions-row">
          <button className="tf-btn-secondary" onClick={() => { void loadJob(); }} disabled={loading}>Refresh</button>
          {job.status === 'failed' && <button className="tf-btn-primary" onClick={() => { void retryJob(); }} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry Job'}</button>}
          {job.status !== 'active' && <button className="tf-btn-danger" onClick={deleteJob} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete Job'}</button>}
        </div>
      </div>
      {error && <p role="alert" className="tf-error-text">{error}</p>}
      <div className="tf-details-grid">
        <div className="tf-card">
          <h2 className="tf-card-title">Job details</h2>
          <div className="tf-keyvalue-list">
            <div className="tf-keyvalue-item"><span className="tf-key">Created At</span><span className="tf-value">{new Date(job.createdAt).toLocaleString()}</span></div>
            <div className="tf-keyvalue-item"><span className="tf-key">Updated At</span><span className="tf-value">{job.updatedAt ? new Date(job.updatedAt).toLocaleString() : '—'}</span></div>
            <div className="tf-keyvalue-item"><span className="tf-key">Started At</span><span className="tf-value">{job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}</span></div>
            <div className="tf-keyvalue-item"><span className="tf-key">Completed At</span><span className="tf-value">{job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'}</span></div>
            <div className="tf-keyvalue-item"><span className="tf-key">Attempts</span><span className="tf-value">{job.attempts}</span></div>
          </div>
        </div>
        <div className="tf-card">
          <h2 className="tf-card-title">Result</h2>
          {job.error ? <pre className="tf-code-block">{job.error}</pre> : job.result ? <pre className="tf-code-block">{JSON.stringify(job.result, null, 2)}</pre> : <div className="tf-pending-box">No result is available for this job yet.</div>}
        </div>
      </div>
      <div className="tf-card" style={{ marginTop: '20px' }}>
        <h2 className="tf-card-title">Job Payload</h2>
        <pre className="tf-code-block">{JSON.stringify(job.payload, null, 2)}</pre>
      </div>
    </div>
  );
};
