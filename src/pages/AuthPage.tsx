import React, { useState } from 'react';
import { useAuth } from '../context/useAuth';
import { createRegisterPayload, passwordsMatch, validateDisplayName } from '../utils/profile';

interface AuthPageProps {
  initialMode?: 'login' | 'register';
  onSuccess?: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ initialMode = 'login', onSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const { login, register, error, clearError } = useAuth();

  const handleToggleMode = (newMode: 'login' | 'register') => {
    setMode(newMode);
    setLocalError(null);
    setDisplayNameError(null);
    setConfirmTouched(false);
    clearError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setDisplayNameError(null);
    clearError();

    // Basic client-side validation
    if (!email.trim() || !password) {
      setLocalError('Please fill in all required fields.');
      return;
    }

    if (mode === 'register') {
      const displayNameValidationError = validateDisplayName(displayName);
      if (displayNameValidationError) {
        setDisplayNameError(displayNameValidationError);
        return;
      }
      if (password.length < 8) {
        setLocalError('Password must be at least 8 characters long.');
        return;
      }
      if (!passwordsMatch(password, confirmPassword)) {
        setConfirmTouched(true);
        return;
      }
    }

    try {
      setSubmitting(true);
      if (mode === 'login') {
        await login({ email: email.trim(), password });
      } else {
        await register(createRegisterPayload(displayName, email, password));
      }
      if (onSuccess) {
        onSuccess();
      }
    } catch {
      // Error is stored in AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = localError || error;

  return (
    <div className="tf-auth-container">
      <div className="tf-auth-card">
        <div className="tf-auth-header">
          <span className="tf-auth-kicker">{mode === 'login' ? 'OPERATOR ACCESS' : 'GET STARTED'}</span>
          <h1 className="tf-auth-title">
            {mode === 'login' ? 'Sign in to TaskFlow' : 'Create an account'}
          </h1>
          <p className="tf-auth-subtitle">
            {mode === 'login'
              ? 'Enter your credentials to manage queues and background jobs'
              : 'Register an operator account to access the distributed job platform'}
          </p>
        </div>

        {displayError && (
          <div className="tf-auth-error-banner" role="alert">
            <span className="tf-auth-error-icon" aria-hidden="true">!</span>
            <span>{displayError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="tf-auth-form">
          {mode === 'register' && (
            <div className="tf-form-group">
              <label htmlFor="auth-display-name" className="tf-form-label">
                Display Name
              </label>
              <input
                id="auth-display-name"
                type="text"
                className="tf-input"
                placeholder="Saran"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setDisplayNameError(null); }}
                disabled={submitting}
                autoFocus
                autoComplete="nickname"
                aria-invalid={displayNameError ? 'true' : undefined}
                aria-describedby={displayNameError ? 'auth-display-name-error' : undefined}
                required
              />
              {displayNameError && <span id="auth-display-name-error" className="tf-field-error" role="alert">{displayNameError}</span>}
            </div>
          )}

          <div className="tf-form-group">
            <label htmlFor="auth-email" className="tf-form-label">
                {mode === 'register' ? 'Email' : 'Email Address'}
            </label>
            <input
              id="auth-email"
              type="email"
              className="tf-input tf-control"
              placeholder="operator@taskflow.dev"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              autoComplete="email"
              autoFocus={mode === 'login'}
              required
            />
          </div>

          <div className="tf-form-group">
            <label htmlFor="auth-password" className="tf-form-label">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              className="tf-input tf-control"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
            />
            {mode === 'register' && (
              <span className="tf-form-help">Must be at least 8 characters.</span>
            )}
          </div>

          {mode === 'register' && (
            <div className="tf-form-group">
              <label htmlFor="auth-confirm-password" className="tf-form-label">Confirm Password</label>
              <input
                id="auth-confirm-password"
                type="password"
                className="tf-input tf-control"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setConfirmTouched(true); }}
                onBlur={() => setConfirmTouched(true)}
                disabled={submitting}
                autoComplete="new-password"
                aria-invalid={confirmTouched && !passwordsMatch(password, confirmPassword) ? 'true' : undefined}
                aria-describedby={confirmTouched && !passwordsMatch(password, confirmPassword) ? 'auth-confirm-password-error' : undefined}
                required
              />
              {confirmTouched && !passwordsMatch(password, confirmPassword) && <span id="auth-confirm-password-error" className="tf-field-error" role="alert">Passwords do not match.</span>}
            </div>
          )}

          <button
            type="submit"
            className="tf-btn-primary tf-btn-block"
            disabled={submitting}
            style={{ marginTop: '8px' }}
          >
            {submitting
              ? mode === 'login'
                ? 'Authenticating...'
                : 'Creating account...'
              : mode === 'login'
              ? 'Sign In'
              : 'Create account'}
          </button>
        </form>

        <div className="tf-auth-footer">
          {mode === 'login' ? (
            <p>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className="tf-btn-link"
                onClick={() => handleToggleMode('register')}
                disabled={submitting}
              >
                Create one now
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{' '}
              <button
                type="button"
                className="tf-btn-link"
                onClick={() => handleToggleMode('login')}
                disabled={submitting}
              >
                Sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
