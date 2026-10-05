import React, { useEffect, useRef, useState } from 'react';
import type { User } from '../types/auth';
import { getProfileDisplayName, getProfileInitial } from '../utils/profile';

export type NavPage = 'landing' | 'dashboard' | 'jobs' | 'job-details' | 'queue-stats' | 'auth' | 'register';

interface NavigationProps {
  activePage: NavPage;
  onNavigate: (page: NavPage) => void;
  user: User | null;
  onLogout: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({ activePage, onNavigate, user, onLogout }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [nameTruncated, setNameTruncated] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const profileNameRef = useRef<HTMLSpanElement>(null);
  const displayName = user ? getProfileDisplayName(user) : '';
  const avatarInitial = user ? getProfileInitial(user) : 'U';

  useEffect(() => {
    const nameElement = profileNameRef.current;
    if (!nameElement) return;
    const measure = () => {
      const truncated = nameElement.scrollWidth > nameElement.clientWidth;
      setNameTruncated((current) => current === truncated ? current : truncated);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nameElement);
    return () => observer.disconnect();
  }, [displayName]);

  useEffect(() => {
    if (!profileOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !profileRef.current?.contains(event.target)) setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileOpen(false);
        profileTriggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileOpen]);

  const navigate = (page: NavPage) => {
    setMenuOpen(false);
    setProfileOpen(false);
    onNavigate(page);
  };

  const logout = () => {
    setProfileOpen(false);
    setMenuOpen(false);
    onLogout();
  };

  return (
    <header className="tf-navbar">
      <div className="tf-navbar-container">
        <button type="button" className="tf-brand tf-brand-button" onClick={() => navigate(user ? 'dashboard' : 'landing')} aria-label="TaskFlow home">
          <img className="tf-logo-image" src="/logo.png" alt="" aria-hidden="true" width={32} height={32} />
          <span className="tf-logo-text">TaskFlow</span>
          {user && <span className="tf-version-pill">OPERATIONS</span>}
        </button>

        {user && (
          <nav className={`tf-nav-links ${menuOpen ? 'is-open' : ''}`} id="primary-navigation" aria-label="Primary navigation">
            <button type="button" className={`tf-nav-item ${activePage === 'dashboard' ? 'active' : ''}`} aria-current={activePage === 'dashboard' ? 'page' : undefined} onClick={() => navigate('dashboard')}>
              <span className="tf-nav-glyph" aria-hidden="true">◫</span>Dashboard
            </button>
            <button type="button" className={`tf-nav-item ${activePage === 'jobs' || activePage === 'job-details' ? 'active' : ''}`} aria-current={activePage === 'jobs' || activePage === 'job-details' ? 'page' : undefined} onClick={() => navigate('jobs')}>
              <span className="tf-nav-glyph" aria-hidden="true">▤</span>Jobs
            </button>
            <button type="button" className={`tf-nav-item ${activePage === 'queue-stats' ? 'active' : ''}`} aria-current={activePage === 'queue-stats' ? 'page' : undefined} onClick={() => navigate('queue-stats')}>
              <span className="tf-nav-glyph" aria-hidden="true">▥</span>Queue stats
            </button>
          </nav>
        )}

        <div className="tf-nav-status">
          {user ? (
            <div className="tf-user-menu">
              <div className="tf-profile-container" ref={profileRef}>
                <button
                  ref={profileTriggerRef}
                  type="button"
                  className="tf-profile-trigger"
                  aria-label={`Profile for ${displayName}`}
                  aria-haspopup="dialog"
                  aria-expanded={profileOpen}
                  aria-controls={profileOpen ? 'profile-popover' : undefined}
                  onClick={() => setProfileOpen((open) => !open)}
                >
                  <span className="tf-user-avatar" aria-hidden="true">{avatarInitial}</span>
                  <span ref={profileNameRef} className={`tf-user-name ${nameTruncated ? 'is-truncated' : ''}`} title={displayName}>{displayName}</span>
                </button>
                {profileOpen && (
                  <div className="tf-profile-popover" id="profile-popover" role="dialog" aria-label="Profile details">
                    <div className="tf-profile-detail"><span>Display name</span><strong>{displayName}</strong></div>
                    <div className="tf-profile-detail"><span>Email</span><strong>{user.email}</strong></div>
                    <button type="button" className="tf-profile-logout" onClick={logout}>Log out</button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="tf-public-actions">
              {activePage === 'landing' && <button type="button" className="tf-public-login" onClick={() => navigate('auth')}>Log in</button>}
              {activePage !== 'auth' && activePage !== 'register' && <button type="button" className="tf-btn-primary tf-btn-nav" onClick={() => navigate('register')}>Sign up</button>}
              {(activePage === 'auth' || activePage === 'register') && <button type="button" className="tf-public-login" onClick={() => navigate('landing')}>Back home</button>}
            </div>
          )}
        </div>

        {user && <button type="button" className="tf-menu-toggle" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen((open) => !open)}>
          <span /><span /><span />
        </button>}
      </div>
    </header>
  );
};
