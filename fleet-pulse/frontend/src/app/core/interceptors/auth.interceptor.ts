
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';

import {
  catchError,
  finalize,
  Observable,
  shareReplay,
  switchMap,
  throwError
} from 'rxjs';

import { Auth } from '../auth/auth';
import { LoginResponse } from '../models/auth.model';

// Shared refresh request for all simultaneous 401 responses.
let refreshRequest$: Observable<LoginResponse> | null = null;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const router = inject(Router);

  const token = auth.getAccessToken();

  // Do not intercept login, refresh or logout requests.
  const isAuthRequest =
    req.url.includes('/auth/login') ||
    req.url.includes('/auth/refresh') ||
    req.url.includes('/auth/logout');

  if (!token || isAuthRequest) {
    return next(req);
  }

  const authRequest = req.clone({
    setHeaders: {
      Authorization: `Bearer ${token}`
    }
  });

  return next(authRequest).pipe(
    catchError((error: unknown) => {

      // Refresh only when the server returns 401.
      if (
        !(error instanceof HttpErrorResponse) ||
        error.status !== 401
      ) {
        return throwError(() => error);
      }

      // Start one refresh request, shared by all failed requests.
      if (!refreshRequest$) {
        refreshRequest$ = auth.refreshAccessToken().pipe(
          catchError((refreshError: unknown) => {
            auth.logout();
            router.navigateByUrl('/login');

            return throwError(() => refreshError);
          }),
          finalize(() => {
            refreshRequest$ = null;
          }),
          shareReplay(1)
        );
      }

      // Wait for the shared refresh and retry with the new token.
      return refreshRequest$.pipe(
        switchMap(response => {
          const retryRequest = req.clone({
            setHeaders: {
              Authorization: `Bearer ${response.accessToken}`
            }
          });

          return next(retryRequest);
        })
      );
    })
  );
};
