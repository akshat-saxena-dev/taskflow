import type { User, AuthResponse, RegisterPayload, LoginPayload } from '../types/auth';

const API_BASE = '/api/auth';

export class AuthApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
  }
}

const handleResponse = async <T>(res: Response): Promise<T> => {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data.error || data.message || `Request failed with status ${res.status}`;
    throw new AuthApiError(errorMsg, res.status);
  }
  return data as T;
};

export const authApi = {
  /**
   * Register a new user and set HTTP-only auth cookie
   */
  async register(payload: RegisterPayload): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    return handleResponse<AuthResponse>(res);
  },

  /**
   * Log in an existing user and set HTTP-only auth cookie
   */
  async login(payload: LoginPayload): Promise<AuthResponse> {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    return handleResponse<AuthResponse>(res);
  },

  /**
   * Log out the current user and clear HTTP-only auth cookie
   */
  async logout(): Promise<{ message: string }> {
    const res = await fetch(`${API_BASE}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    return handleResponse<{ message: string }>(res);
  },

  /**
   * Get currently authenticated user profile
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const res = await fetch(`${API_BASE}/me`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (res.status === 401) {
        return null;
      }

      const data = await handleResponse<{ user: User }>(res);
      return data.user;
    } catch (err: unknown) {
      if (err instanceof AuthApiError && err.status === 401) {
        return null;
      }
      throw err;
    }
  }
};
