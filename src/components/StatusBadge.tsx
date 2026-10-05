import type { JobStatus } from '../types/job';

interface StatusBadgeProps {
  status: JobStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  return (
    <span className={`tf-status-badge tf-status-${status}`} aria-label={`Status: ${status}`}>
      {status}
    </span>
  );
};
