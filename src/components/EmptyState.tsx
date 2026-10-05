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
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 16px',
        textAlign: 'center',
        border: '1px dashed #cbd5e1',
        borderRadius: '6px',
        backgroundColor: '#f8fafc',
        margin: '16px 0'
      }}
    >
      <div style={{ fontSize: '15px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
        {title}
      </div>
      <div style={{ fontSize: '13px', color: '#64748b', maxWidth: '380px', marginBottom: actionText ? '16px' : 0 }}>
        {description}
      </div>
      {actionText && onAction && (
        <button
          onClick={onAction}
          style={{
            padding: '6px 14px',
            fontSize: '13px',
            fontWeight: 500,
            color: '#1e293b',
            backgroundColor: '#ffffff',
            border: '1px solid #cbd5e1',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          {actionText}
        </button>
      )}
    </div>
  );
};
