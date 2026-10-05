import { useEffect, useState } from 'react';
import type { QueueStatsResponse } from '../types/job';
import { api } from '../services/api';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';

export const QueueStatsPage: React.FC = () => {
  const [stats, setStats] = useState<QueueStatsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getQueueStats();
      setStats(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch queue statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getQueueStats();
        if (isMounted) {
          setStats(data);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch queue statistics');
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
  }, []);

  if (loading) {
    return <LoadingState message="Loading queue and worker telemetry..." />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadStats} />;
  }

  if (!stats) return null;

  const totalWaiting = stats.queues.reduce((acc, q) => acc + q.waiting, 0);
  const totalActive = stats.queues.reduce((acc, q) => acc + q.active, 0);

  return (
    <div className="tf-page">
      <div className="tf-page-header">
        <div>
          <h1 className="tf-page-title">Queue & Worker Stats</h1>
          <p className="tf-page-subtitle">Telemetry for BullMQ queues, worker pools, and throughput</p>
        </div>
        <button className="tf-btn-secondary" onClick={loadStats}>
          Refresh
        </button>
      </div>

      {/* Top Overview Cards */}
      <div className="tf-stats-grid">
        <div className="tf-stat-card">
          <span className="tf-stat-label">Total Queues</span>
          <span className="tf-stat-value">{stats.queues.length}</span>
        </div>
        <div className="tf-stat-card">
          <span className="tf-stat-label">Connected Workers</span>
          <span className="tf-stat-value">{stats.workers.length}</span>
        </div>
        <div className="tf-stat-card">
          <span className="tf-stat-label">Total Backlog (Depth)</span>
          <span className="tf-stat-value">{totalWaiting}</span>
        </div>
        <div className="tf-stat-card tf-stat-active">
          <span className="tf-stat-label">Jobs in Flight</span>
          <span className="tf-stat-value">{totalActive}</span>
        </div>
        <div className="tf-stat-card tf-stat-completed">
          <span className="tf-stat-label">Throughput / min</span>
          <span className="tf-stat-value">{stats.totalThroughput}</span>
        </div>
      </div>

      {/* Queues Table */}
      <div className="tf-card" style={{ marginTop: '24px' }}>
        <h2 className="tf-card-title">Queue Metrics</h2>
        <div className="tf-table-wrapper">
          <table className="tf-table">
            <thead>
              <tr>
                <th>Queue Name</th>
                <th>Backlog (Waiting)</th>
                <th>Active</th>
                <th>Completed</th>
                <th>Failed</th>
                <th>Delayed</th>
                <th>Throughput</th>
                <th>Avg Latency</th>
              </tr>
            </thead>
            <tbody>
              {stats.queues.map((q) => (
                <tr key={q.name}>
                  <td>
                    <strong>{q.name}</strong>
                  </td>
                  <td>
                    <span className="tf-mono-tag">{q.waiting}</span>
                  </td>
                  <td>
                    <span style={{ color: '#2563eb', fontWeight: 600 }}>{q.active}</span>
                  </td>
                  <td className="tf-muted-text">{q.completed.toLocaleString()}</td>
                  <td>
                    {q.failed > 0 ? (
                      <span style={{ color: '#dc2626', fontWeight: 600 }}>{q.failed}</span>
                    ) : (
                      <span className="tf-muted-text">0</span>
                    )}
                  </td>
                  <td className="tf-muted-text">{q.delayed}</td>
                  <td>{q.throughputPerMinute} / min</td>
                  <td>{(q.avgDurationMs / 1000).toFixed(2)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Workers Table */}
      <div className="tf-card" style={{ marginTop: '24px' }}>
        <h2 className="tf-card-title">Worker Nodes</h2>
        <div className="tf-table-wrapper">
          <table className="tf-table">
            <thead>
              <tr>
                <th>Worker ID</th>
                <th>Name / Node</th>
                <th>Status</th>
                <th>Load (Active / Concurrency)</th>
                <th>Total Processed</th>
                <th>Total Failed</th>
                <th>Uptime</th>
              </tr>
            </thead>
            <tbody>
              {stats.workers.map((w) => {
                const uptimeHours = Math.floor(w.uptimeSeconds / 3600);
                const uptimeDays = Math.floor(uptimeHours / 24);

                return (
                  <tr key={w.id}>
                    <td>
                      <span className="tf-mono-tag">{w.id}</span>
                    </td>
                    <td>{w.name}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '12px',
                          fontWeight: 500,
                          color: w.status === 'busy' ? '#1d4ed8' : w.status === 'idle' ? '#15803d' : '#6b7280'
                        }}
                      >
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor:
                              w.status === 'busy' ? '#3b82f6' : w.status === 'idle' ? '#22c55e' : '#9ca3af'
                          }}
                        />
                        {w.status.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className="tf-mono-text">
                        {w.activeJobs} / {w.concurrency}
                      </span>
                    </td>
                    <td className="tf-muted-text">{w.totalProcessed.toLocaleString()}</td>
                    <td>
                      {w.totalFailed > 0 ? (
                        <span style={{ color: '#dc2626' }}>{w.totalFailed}</span>
                      ) : (
                        <span className="tf-muted-text">0</span>
                      )}
                    </td>
                    <td className="tf-muted-text">
                      {uptimeDays > 0 ? `${uptimeDays}d ${uptimeHours % 24}h` : `${uptimeHours}h`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
