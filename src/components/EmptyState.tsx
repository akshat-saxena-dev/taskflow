import React from 'react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'No items found',
  description = 'There are no jobs matching the current criteria.',
  actionText,
  onAction
}) => (
  <section className="tf-state">
    <div className="tf-state-content">
      <span className="tf-state-icon" aria-hidden="true">⌕</span>
      <h2 className="tf-state-title">{title}</h2>
      <p className="tf-state-description">{description}</p>
      {actionText && onAction && <button type="button" className="tf-btn-secondary" onClick={onAction}>{actionText}</button>}
    </div>
  </section>
);
