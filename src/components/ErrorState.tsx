import React from 'react';

interface ErrorStateProps { message: string; onRetry?: () => void; }

export const ErrorState: React.FC<ErrorStateProps> = ({ message, onRetry }) => (
  <section className="tf-state tf-state-error" role="alert">
    <div className="tf-state-content">
      <span className="tf-state-icon" aria-hidden="true">!</span>
      <h2 className="tf-state-title">We couldn’t load this view</h2>
      <p className="tf-state-description">{message}</p>
      {onRetry && <button type="button" className="tf-btn-secondary" onClick={onRetry}>Try again</button>}
    </div>
  </section>
);
