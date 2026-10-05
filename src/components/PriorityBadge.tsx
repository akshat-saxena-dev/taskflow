import type { JobPriority } from '../types/job';

interface PriorityBadgeProps {
  priority: JobPriority;
}

const priorityStyles: Record<JobPriority, { bg: string; text: string; label: string }> = {
  low: { bg: '#f1f5f9', text: '#475569', label: 'Low' },
  normal: { bg: '#e0f2fe', text: '#0369a1', label: 'Normal' },
  high: { bg: '#ffedd5', text: '#c2410c', label: 'High' },
  critical: { bg: '#ffe4e6', text: '#be123c', label: 'Critical' }
};

export const PriorityBadge: React.FC<PriorityBadgeProps> = ({ priority }) => {
  const config = priorityStyles[priority] || { bg: '#f1f5f9', text: '#475569', label: priority };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 6px',
        borderRadius: '3px',
        fontSize: '11px',
        fontWeight: 600,
        backgroundColor: config.bg,
        color: config.text,
        textTransform: 'uppercase',
        letterSpacing: '0.04em'
      }}
    >
      {config.label}
    </span>
  );
};
