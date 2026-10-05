export interface User {
  id: string;
  name: string;
  displayName?: string | null;
  email: string;
  createdAt?: string;
}

export interface AuthResponse {
  message: string;
  user: User;
}

export interface RegisterPayload {
  displayName: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}
