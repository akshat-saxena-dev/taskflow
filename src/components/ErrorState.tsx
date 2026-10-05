import React from 'react';

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({ message, onRetry }) => {
  return (
    <div
      style={{
        padding: '16px',
        margin: '16px 0',
        backgroundColor: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: '6px',
        color: '#991b1b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px'
      }}
    >
      <div>
        <strong style={{ fontSize: '14px', display: 'block' }}>Error Loading Data</strong>
        <span style={{ fontSize: '13px' }}>{message}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            padding: '6px 12px',
            fontSize: '13px',
            backgroundColor: '#ffffff',
            border: '1px solid #f87171',
            borderRadius: '4px',
            color: '#b91c1c',
            cursor: 'pointer',
            fontWeight: 500,
            whiteSpace: 'nowrap'
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
};
