import React, { useState, useEffect } from 'react';
import type { User, RegisterPayload, LoginPayload } from '../types/auth';
import { authApi, AuthApiError } from '../services/authApi';
import { AuthContext } from './AuthContext';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const checkCurrentUser = async () => {
      try {
        const currentUser = await authApi.getCurrentUser();
        if (isMounted) {
          setUser(currentUser);
        }
      } catch (err: unknown) {
        // Backend may be offline or unconfigured; fail gracefully without crashing UI
        console.warn('[Auth] Session check unverified:', err instanceof Error ? err.message : err);
        if (isMounted) {
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void checkCurrentUser();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (payload: LoginPayload) => {
    setError(null);
    try {
      const response = await authApi.login(payload);
      setUser(response.user);
    } catch (err: unknown) {
      const message = err instanceof AuthApiError ? err.message : 'Login failed. Please try again.';
      setError(message);
      throw err;
    }
  };

  const register = async (payload: RegisterPayload) => {
    setError(null);
    try {
      const response = await authApi.register(payload);
      setUser(response.user);
    } catch (err: unknown) {
      const message =
        err instanceof AuthApiError ? err.message : 'Registration failed. Please try again.';
      setError(message);
      throw err;
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (err: unknown) {
      console.warn('[Auth] Logout warning:', err);
    } finally {
      setUser(null);
      setError(null);
    }
  };

  const clearError = () => setError(null);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        register,
        logout,
        clearError
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
