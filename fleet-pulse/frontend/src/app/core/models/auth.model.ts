
export interface LoginRequest {
  email: string;
  password: string;
}

export type UserRole = 'operator' | 'viewer';

export interface User {
  id: string;
  email: string;
  role: UserRole;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
}
