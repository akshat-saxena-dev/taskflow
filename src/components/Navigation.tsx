import React from 'react';
import type { User } from '../types/auth';

export type NavPage = 'dashboard' | 'jobs' | 'job-details' | 'queue-stats' | 'auth';

interface NavigationProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  selectedJobId?: string | null;
  user: User | null;
  onLogout: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  activePage,
  onNavigate,
  selectedJobId,
  user,
  onLogout
}) => {
  return (
    <header className="tf-navbar">
      <div className="tf-navbar-container">
        <div
          className="tf-brand"
          onClick={() => onNavigate(user ? 'dashboard' : 'auth')}
          style={{ cursor: 'pointer' }}
        >
          <span className="tf-logo-icon">⚡</span>
          <span className="tf-logo-text">TaskFlow</span>
          <span className="tf-version-pill">v0.2-auth</span>
        </div>

        {user && (
          <nav className="tf-nav-links">
            <button
              type="button"
              className={`tf-nav-item ${activePage === 'dashboard' ? 'active' : ''}`}
              onClick={() => onNavigate('dashboard')}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`tf-nav-item ${activePage === 'jobs' ? 'active' : ''}`}
              onClick={() => onNavigate('jobs')}
            >
              Jobs
            </button>
            <button
              type="button"
              className={`tf-nav-item ${activePage === 'queue-stats' ? 'active' : ''}`}
              onClick={() => onNavigate('queue-stats')}
            >
              Queue Stats
            </button>
            {selectedJobId && activePage === 'job-details' && (
              <button
                type="button"
                className="tf-nav-item active"
                onClick={() => onNavigate('job-details')}
              >
                Job: {selectedJobId}
              </button>
            )}
          </nav>
        )}

        <div className="tf-nav-status">
          {user ? (
            <div className="tf-user-menu">
              <span className="tf-user-badge" title={user.email}>
                <span className="tf-user-avatar">👤</span>
                <span className="tf-user-name">{user.name}</span>
              </span>
              <button
                type="button"
                className="tf-btn-xs"
                onClick={onLogout}
                title="Log out of TaskFlow"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="tf-btn-primary tf-btn-xs"
              onClick={() => onNavigate('auth')}
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
