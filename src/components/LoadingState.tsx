import React from 'react';

interface LoadingStateProps { message?: string; }

export const LoadingState: React.FC<LoadingStateProps> = ({ message = 'Loading data...' }) => (
  <div className="tf-state" role="status" aria-live="polite">
    <div className="tf-state-content">
      <div className="tf-spinner" aria-hidden="true" />
      <span className="tf-state-message">{message}</span>
    </div>
  </div>
);
