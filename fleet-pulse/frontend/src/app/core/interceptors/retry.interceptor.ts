
import {
  HttpErrorResponse,
  HttpInterceptorFn
} from '@angular/common/http';

import {
  retry,
  throwError,
  timer,
  timeout,
  TimeoutError
} from 'rxjs';

export const retryInterceptor: HttpInterceptorFn = (req, next) => {

  // POST requests are retryable only with an Idempotency-Key.
  const canRetry =
    req.method === 'GET' ||
    (req.method === 'POST' &&
      req.headers.has('Idempotency-Key'));

  // Apply a 10-second timeout to every request.
  const request$ = next(req).pipe(
    timeout({ first: 10000 })
  );

  if (!canRetry) {
    return request$;
  }

  // Maximum 3 attempts in total (initial + 2 retries).
  return request$.pipe(
    retry({
      count: 2,
      delay: (error: unknown, retryCount: number) => {

        const isNetworkError =
          error instanceof HttpErrorResponse &&
          error.status === 0;

        const isTimeout = error instanceof TimeoutError;

        const isRetryableStatus =
          error instanceof HttpErrorResponse &&
         [429, 500, 502, 503, 504].includes(error.status);

        if (
          !isNetworkError &&
          !isTimeout &&
          !isRetryableStatus
        ) {
          return throwError(() => error);
        }

        // Respect Retry-After when the server provides it.
        if (
          error instanceof HttpErrorResponse &&
          error.status === 429
        ) {
          const retryAfter = error.headers.get('Retry-After');

          if (retryAfter) {
            const seconds = Number(retryAfter);

            if (Number.isFinite(seconds) && seconds >= 0) {
              return timer(seconds * 1000);
            }

            const retryDate = Date.parse(retryAfter);

            if (!Number.isNaN(retryDate)) {
              return timer(
                Math.max(0, retryDate - Date.now())
              );
            }
          }
        }

        // Exponential delay when Retry-After is unavailable.
        const delayMs = Math.min(
          500 * Math.pow(2, retryCount - 1),
          5000
        );

        return timer(delayMs);
      }
    })
  );
};
