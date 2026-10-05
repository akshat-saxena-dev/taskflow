import type { JobPriority } from '../types/job';

interface PriorityBadgeProps {
  priority: JobPriority;
}

export const PriorityBadge: React.FC<PriorityBadgeProps> = ({ priority }) => {
  return (
    <span className={`tf-priority-badge tf-priority-${priority}`} aria-label={`Priority: ${priority}`}>
      {priority}
    </span>
  );
};
