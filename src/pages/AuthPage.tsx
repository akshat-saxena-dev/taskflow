import React, { useState } from 'react';
import { useAuth } from '../context/useAuth';

interface AuthPageProps {
  onSuccess?: () => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const { login, register, error, clearError } = useAuth();

  const handleToggleMode = (newMode: 'login' | 'register') => {
    setMode(newMode);
    setLocalError(null);
    clearError();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    // Basic client-side validation
    if (!email.trim() || !password) {
      setLocalError('Please fill in all required fields.');
      return;
    }

    if (mode === 'register') {
      if (!name.trim()) {
        setLocalError('Please enter your full name.');
        return;
      }
      if (password.length < 8) {
        setLocalError('Password must be at least 8 characters long.');
        return;
      }
    }

    try {
      setSubmitting(true);
      if (mode === 'login') {
        await login({ email: email.trim(), password });
      } else {
        await register({ name: name.trim(), email: email.trim(), password });
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
          <div className="tf-brand" style={{ justifyContent: 'center', marginBottom: '12px' }}>
            <span className="tf-logo-icon">⚡</span>
            <span className="tf-logo-text" style={{ fontSize: '20px' }}>TaskFlow</span>
          </div>
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
            <span className="tf-auth-error-icon">⚠️</span>
            <span>{displayError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="tf-auth-form">
          {mode === 'register' && (
            <div className="tf-form-group">
              <label htmlFor="auth-name" className="tf-form-label">
                Full Name
              </label>
              <input
                id="auth-name"
                type="text"
                className="tf-input"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
                autoFocus
                required
              />
            </div>
          )}

          <div className="tf-form-group">
            <label htmlFor="auth-email" className="tf-form-label">
              Email Address
            </label>
            <input
              id="auth-email"
              type="email"
              className="tf-input"
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
              className="tf-input"
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
              : 'Register Account'}
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
