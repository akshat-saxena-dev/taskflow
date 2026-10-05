import type { JobStatus } from '../types/job';

interface StatusBadgeProps {
  status: JobStatus;
}

const statusStyles: Record<JobStatus, { bg: string; text: string; label: string }> = {
  waiting: { bg: '#fef3c7', text: '#92400e', label: 'Waiting' },
  active: { bg: '#dbeafe', text: '#1e40af', label: 'Active' },
  completed: { bg: '#dcfce7', text: '#166534', label: 'Completed' },
  failed: { bg: '#fee2e2', text: '#991b1b', label: 'Failed' },
  delayed: { bg: '#f3e8ff', text: '#6b21a8', label: 'Delayed' },
  cancelled: { bg: '#f3f4f6', text: '#4b5563', label: 'Cancelled' }
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const config = statusStyles[status] || { bg: '#f3f4f6', text: '#374151', label: status };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '12px',
        fontWeight: 500,
        backgroundColor: config.bg,
        color: config.text,
        textTransform: 'capitalize',
        letterSpacing: '0.02em',
        border: `1px solid ${config.text}20`
      }}
    >
      {config.label}
    </span>
  );
};
