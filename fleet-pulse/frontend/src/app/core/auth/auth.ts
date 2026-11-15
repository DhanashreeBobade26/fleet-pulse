
import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, throwError, catchError, map, of } from 'rxjs';

import {
  LoginRequest,
  LoginResponse,
  User
} from '../models/auth.model';

@Injectable({
  providedIn: 'root'
})
export class Auth {

  private readonly apiUrl = 'http://localhost:4000/auth';

  private accessToken: string | null = null;

  currentUser = signal<User | null>(null);

  constructor(private http: HttpClient) {}

  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(
      `${this.apiUrl}/login`,
      credentials,
      { withCredentials: true }
    ).pipe(
      tap(response => {
        this.accessToken = response.accessToken;
        this.currentUser.set(response.user);
      })
    );
  }

  refreshAccessToken(): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(
      `${this.apiUrl}/refresh`,
      {},
      { withCredentials: true }
    ).pipe(
      tap(response => {
        this.accessToken = response.accessToken;
        this.currentUser.set(response.user);
      })
    );
  }

  restoreSession(): Observable<void> {
  return this.refreshAccessToken().pipe(
    map(() => undefined),
    catchError(() => {
      this.accessToken = null;
      this.currentUser.set(null);
      return of(undefined);
    })
  );
}

  getAccessToken(): string | null {
    return this.accessToken;
  }

  isLoggedIn(): boolean {
    return this.accessToken !== null;
  }

  hasRole(role: 'operator' | 'viewer'): boolean {
    return this.currentUser()?.role === role;
  }

  logout(): void {
    this.http.post(
      `${this.apiUrl}/logout`,
      {},
      { withCredentials: true }
    ).subscribe({
      error: error => console.error('Logout request failed:', error)
    });

    this.accessToken = null;
    this.currentUser.set(null);
  }
}
