import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import {
  ConnectionStatus,
  MetricEvent
} from '../models/metric-event.model';
import { Auth } from '../auth/auth';
import { inject } from '@angular/core';
import {
  HttpClient,
  HttpErrorResponse
} from '@angular/common/http';
import { Subscription, timer, switchMap, catchError, EMPTY } from 'rxjs';
import { Router } from '@angular/router';

interface SnapshotMetric {
  serviceId: string;
  p95: number;
  errRate: number;
  rps: number;
  status: MetricEvent['status'];
  ts: number;
}

interface SnapshotResponse {
  offset: number;
  timestamp: number;
  total: number;
  metrics: SnapshotMetric[];
}

interface ReplayResponse {
  expired: boolean;
  oldestOffset: number;
  currentOffset: number;
  events: MetricEvent[];
}

@Injectable({
  providedIn: 'root'
})
export class Stream {

  private readonly apiUrl = 'http://localhost:4000';
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private socket: WebSocket | null = null;
  private eventSource: EventSource | null = null;
  private wsFailureCount = 0;
  private refreshingWebSocketToken = false;
  private sseFailureCount = 0;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private sseRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private wsConnectionTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;
  private readonly http = inject(HttpClient);

  private pollingSubscription: Subscription | null = null;
  private promotionTimer: ReturnType<typeof setInterval> | null = null;
  // Stores the latest connection status.
  connectionStatus = signal<ConnectionStatus>('offline');
  private lastMetricAt = Date.now();
  private lastProcessedOffset = 0;
  private replayInProgress = false;
  malformedEventCount = signal(0);
  duplicateEventCount = signal(0);
  private gapRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingEvents = new Map<number, MetricEvent>();
  // Tracks the latest processed sequence number for each service.
  private lastProcessedSeq = new Map<string, number>();
  private staleCheckTimer: ReturnType<typeof setInterval> | null = null;
  private wsStableTimer: ReturnType<typeof setTimeout> | null = null;

  // Publishes incoming metric events to components.
  private metricSubject = new Subject<MetricEvent>();

  // Components can subscribe to this observable.
  metrics$ = this.metricSubject.asObservable();


  private readonly handleOffline = (): void => {
    console.warn('Browser is offline');

    this.manuallyClosed = true;

    if (this.wsRetryTimer) {
      clearTimeout(this.wsRetryTimer);
      this.wsRetryTimer = null;
    }

    if (this.wsConnectionTimer) {
      clearTimeout(this.wsConnectionTimer);
      this.wsConnectionTimer = null;
    }

    if (this.promotionTimer) {
      clearInterval(this.promotionTimer);
      this.promotionTimer = null;
    }

    this.stopPolling();
    this.disconnectSSE();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.connectionStatus.set('offline');
  };

  private readonly handleOnline = (): void => {
    console.log('Browser is online again');

    if (!this.auth.getAccessToken()) {
      return;
    }

    this.manuallyClosed = false;
    this.connectWebSocket();
  };

  constructor() {
    window.addEventListener('offline', this.handleOffline);
    window.addEventListener('online', this.handleOnline);

    this.startStaleCheck();
  }

  initializeOffset(): void {
    this.http.get<SnapshotResponse>(
      `${this.apiUrl}/metrics/snapshot`
    ).subscribe({
      next: (response) => {
        this.lastProcessedOffset = response.offset;

        console.log(
          'Initial metric offset:',
          this.lastProcessedOffset
        );

        this.connectWebSocket();
      },
      error: (error: unknown) => {
        console.error('Failed to initialize metric offset:', error);
      }
    });
  }

  connectWebSocket(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING ||
        this.socket.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    this.manuallyClosed = false;

    if (this.wsRetryTimer) {
      clearTimeout(this.wsRetryTimer);
      this.wsRetryTimer = null;
    }

    const token = this.auth.getAccessToken();

    if (!token) {
      console.error('Access token is missing.');
      return;
    }

    this.connectionStatus.set('reconnecting');

    const socket = new WebSocket(
      `${this.apiUrl.replace('http', 'ws')}/stream?token=${encodeURIComponent(token)}`
    );

    this.socket = socket;

    this.wsConnectionTimer = setTimeout(() => {
      if (
        this.socket === socket &&
        socket.readyState !== WebSocket.OPEN
      ) {
        console.warn('WebSocket connection timed out after 5 seconds');
        socket.close();
      }
    }, 5000);

    socket.onopen = () => {
      if (this.socket !== socket) return;

      console.log('WebSocket connected successfully');

      if (this.wsConnectionTimer) {
        clearTimeout(this.wsConnectionTimer);
        this.wsConnectionTimer = null;
      }

      // Reset failures only after a stable connection
      if (this.wsStableTimer) {
        clearTimeout(this.wsStableTimer);
      }

      this.wsStableTimer = setTimeout(() => {
        if (
          this.socket === socket &&
          socket.readyState === WebSocket.OPEN
        ) {
          this.wsFailureCount = 0;
          console.log('WebSocket connection is stable.');
        }

        this.wsStableTimer = null;
      }, 10000);

      this.stopPolling();

      if (this.promotionTimer) {
        clearInterval(this.promotionTimer);
        this.promotionTimer = null;
      }

      this.disconnectSSE();
      this.connectionStatus.set('live-ws');
    };

    socket.onmessage = (message: MessageEvent) => {
      if (this.socket !== socket) return;

      const event = this.parseMetricEvent(message.data, 'WebSocket');

      if (event) {
        this.handleMetricEvent(event);
      }
    };

    socket.onerror = (error: Event) => {
      if (this.socket !== socket) return;
      console.error('WebSocket error:', error);
    };


    socket.onclose = (event: CloseEvent) => {
      console.log('WebSocket closed:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean
      });

      if (this.socket !== socket) return;

      this.socket = null;
      if (this.wsStableTimer) {
        clearTimeout(this.wsStableTimer);
        this.wsStableTimer = null;
      }
      if (this.wsConnectionTimer) {
        clearTimeout(this.wsConnectionTimer);
        this.wsConnectionTimer = null;
      }

      if (this.manuallyClosed) return;

      // Handle expired access token.
      if (event.code === 4401) {
        if (this.refreshingWebSocketToken) return;

        console.log('Refreshing expired WebSocket token...');

        this.refreshingWebSocketToken = true;

        this.auth.refreshAccessToken().subscribe({
          next: () => {
            this.refreshingWebSocketToken = false;

            console.log('Token refreshed successfully.');

            if (!this.manuallyClosed) {
              this.connectWebSocket();
            }
          },
          error: (error: unknown) => {
            this.refreshingWebSocketToken = false;

            console.error('Token refresh failed:', error);

            this.manuallyClosed = true;
            this.disconnectWebSocket();
            this.auth.logout();
            this.router.navigateByUrl('/login');
          }
        });

        return;
      }

      this.wsFailureCount++;

      console.log('WebSocket failure count:', this.wsFailureCount);

      if (this.wsFailureCount >= 3) {
        console.log('Switching to SSE');
        this.connectSSE();
        return;
      }

      this.connectionStatus.set('reconnecting');

      const baseDelay = Math.min(
        1000 * Math.pow(2, this.wsFailureCount - 1),
        30000
      );

      const jitter = Math.random() * 500;
      const retryDelay = Math.min(baseDelay + jitter, 30000);

      this.wsRetryTimer = setTimeout(
        () => this.connectWebSocket(),
        retryDelay
      );
    };

  }


  disconnectWebSocket(): void {
    this.manuallyClosed = true;

    if (this.wsRetryTimer) {
      clearTimeout(this.wsRetryTimer);
      this.wsRetryTimer = null;
    }

    if (this.wsConnectionTimer) {
      clearTimeout(this.wsConnectionTimer);
      this.wsConnectionTimer = null;
    }

    if (this.promotionTimer) {
      clearInterval(this.promotionTimer);
      this.promotionTimer = null;
    }

    this.stopPolling();
    this.disconnectSSE();

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.connectionStatus.set('offline');
  }

  connectSSE(): void {
    const token = this.auth.getAccessToken();

    if (!token) {
      console.error('Access token is missing.');
      return;
    }

    this.connectionStatus.set('reconnecting');

    this.eventSource = new EventSource(
      `${this.apiUrl}/stream/sse?token=${token}`
    );

    this.eventSource.onopen = () => {
      console.log('SSE connected successfully');
      this.sseFailureCount = 0;
      this.connectionStatus.set('live-sse');
      this.startPromotionCheck();
    };

    this.eventSource.onmessage = (message: MessageEvent) => {
      const event = this.parseMetricEvent(message.data, 'SSE');

      if (event) {
        this.handleMetricEvent(event);
      }
    };

    this.eventSource.onerror = () => {
      console.error('SSE connection error');

      this.disconnectSSE();
      this.sseFailureCount++;

      console.log('SSE failure count:', this.sseFailureCount);

      if (this.sseFailureCount >= 3) {
        console.log('SSE failed 3 times. Switching to HTTP polling.');

        this.disconnectSSE();
        this.startPolling();
        return;
      }

      this.connectionStatus.set('reconnecting');

      const baseDelay = Math.min(
        1000 * Math.pow(2, this.sseFailureCount - 1),
        30000
      );

      const jitter = Math.random() * 500;
      const retryDelay = Math.min(baseDelay + jitter, 30000);

      this.sseRetryTimer = setTimeout(() => {
        this.sseRetryTimer = null;
        this.connectSSE();
      }, retryDelay);
    };
  }

  disconnectSSE(): void {
    if (this.sseRetryTimer) {
      clearTimeout(this.sseRetryTimer);
      this.sseRetryTimer = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private getPollingIntervalMs(): number {
    // Assignment requirement: HTTP polling every 2 seconds.
    return 2000;
  }


  startPolling(): void {
    // Avoid starting multiple polling subscriptions.
    if (this.pollingSubscription) {
      return;
    }

    console.log('Starting HTTP polling');

    this.connectionStatus.set('polling');

    this.pollingSubscription = timer(
      0,
      this.getPollingIntervalMs()
    )
      .pipe(
        switchMap(() =>
          this.http.get<SnapshotResponse>(
            `${this.apiUrl}/metrics/snapshot`
          ).pipe(
            catchError((error: unknown) => {
              console.error('Snapshot polling failed:', error);
              return EMPTY;
            })
          )
        )
      )
      .subscribe({
        next: (response) => {
          response.metrics.forEach(metric => {
            this.metricSubject.next({
              type: 'metric',
              offset: response.offset,
              serviceId: metric.serviceId,
              seq: 0,
              ts: metric.ts,
              p95: metric.p95,
              errRate: metric.errRate,
              rps: metric.rps,
              status: metric.status
            });
          });

          this.lastProcessedOffset = Math.max(
            this.lastProcessedOffset,
            response.offset
          );

          this.lastMetricAt = Date.now();
        }
      });
    this.startPromotionCheck();
  }

  stopPolling(): void {
    this.pollingSubscription?.unsubscribe();
    this.pollingSubscription = null;
  }

  startPromotionCheck(): void {
    if (this.promotionTimer) {
      return;
    }

    this.promotionTimer = setInterval(() => {
      if (
        this.connectionStatus() === 'polling' ||
        this.connectionStatus() === 'live-sse' ||
        this.connectionStatus() === 'stale'
      ) {
        console.log('Checking whether WebSocket is available again');

        this.wsFailureCount = 0;
        this.connectWebSocket();
      }
    }, 30000);
  }

  private startStaleCheck(): void {
    if (this.staleCheckTimer) return;

    this.staleCheckTimer = setInterval(() => {
      const status = this.connectionStatus();

      if (
        status !== 'live-ws' &&
        status !== 'live-sse' &&
        status !== 'polling' &&
        status !== 'stale'
      ) {
        return;
      }

      const secondsSinceLastEvent =
        (Date.now() - this.lastMetricAt) / 1000;

      if (secondsSinceLastEvent >= 10) {
        if (status !== 'stale') {
          console.warn('Metric stream is stale. No events received for 10 seconds.');
          this.connectionStatus.set('stale');
        }

        // Close a silent WebSocket so its reconnect/fallback
        // logic can take over.
        if (
          this.socket &&
          this.socket.readyState === WebSocket.OPEN
        ) {
          this.socket.close();
        }
      }
    }, 1000);
  }

  private parseMetricEvent(
    data: string,
    source: string
  ): MetricEvent | null {
    let parsed: unknown;

    try {
      parsed = JSON.parse(data);
    } catch (error: unknown) {
      this.malformedEventCount.update(count => count + 1);
      console.error(`Invalid ${source} JSON message:`, error);
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.malformedEventCount.update(count => count + 1);
      console.error(`Malformed ${source} event: Invalid event object`);
      return null;
    }

    const event = parsed as Record<string, unknown>;

    if (typeof event['type'] === 'string' && event['type'] !== 'metric') {
      return null;
    }

    const isValid =
      event['type'] === 'metric' &&
      typeof event['serviceId'] === 'string' &&
      event['serviceId'].length > 0 &&
      typeof event['offset'] === 'number' &&
      Number.isFinite(event['offset']) &&
      typeof event['seq'] === 'number' &&
      Number.isFinite(event['seq']) &&
      typeof event['ts'] === 'number' &&
      Number.isFinite(event['ts']) &&
      typeof event['p95'] === 'number' &&
      Number.isFinite(event['p95']) &&
      typeof event['errRate'] === 'number' &&
      Number.isFinite(event['errRate']) &&
      typeof event['rps'] === 'number' &&
      Number.isFinite(event['rps']) &&
      typeof event['status'] === 'string';

    if (!isValid) {
      this.malformedEventCount.update(count => count + 1);
      console.error(`Malformed ${source} metric event:`, parsed);
      return null;
    }

    return event as unknown as MetricEvent;
  }

  private processMetricEvent(event: MetricEvent): void {
    if (event.offset !== this.lastProcessedOffset + 1) {
      return;
    }

    const lastSeq = this.lastProcessedSeq.get(event.serviceId) ?? 0;
    const isNewServiceEvent = event.seq > lastSeq;

    // Advance global offset even for duplicate service sequences.
    this.lastProcessedOffset = event.offset;

    if (isNewServiceEvent) {
      this.lastProcessedSeq.set(event.serviceId, event.seq);
      this.metricSubject.next(event);
    } else {
      this.duplicateEventCount.update(count => count + 1);
    }

    this.lastMetricAt = Date.now();

    if (this.connectionStatus() === 'stale') {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.connectionStatus.set('live-ws');
      } else if (this.eventSource?.readyState === EventSource.OPEN) {
        this.connectionStatus.set('live-sse');
      } else if (this.pollingSubscription) {
        this.connectionStatus.set('polling');
      }
    }
  }

  private drainPendingEvents(): void {
    while (true) {
      const nextOffset = this.lastProcessedOffset + 1;
      const nextEvent = this.pendingEvents.get(nextOffset);

      if (!nextEvent) {
        break;
      }

      this.pendingEvents.delete(nextOffset);
      this.processMetricEvent(nextEvent);
    }

    if (this.pendingEvents.size === 0) {
      if (this.gapRecoveryTimer) {
        clearTimeout(this.gapRecoveryTimer);
        this.gapRecoveryTimer = null;
      }

      return;
    }

    if (!this.gapRecoveryTimer) {
      const expectedOffset = this.lastProcessedOffset + 1;
      const receivedOffset = Math.min(...this.pendingEvents.keys());

      console.warn(
        'Sequence gap detected. Expected:',
        expectedOffset,
        'Received:',
        receivedOffset
      );

      this.gapRecoveryTimer = setTimeout(() => {
        this.gapRecoveryTimer = null;

        if (!this.replayInProgress) {
          this.requestReplay();
        } else {
          this.drainPendingEvents();
        }
      }, 1000);
    }
  }

  private requestReplay(): void {
    if (this.replayInProgress) {
      return;
    }

    this.replayInProgress = true;

    console.log(
      'Requesting missing events after offset:',
      this.lastProcessedOffset
    );

    this.http.get<ReplayResponse>(
      `${this.apiUrl}/metrics/replay`,
      {
        params: {
          since: this.lastProcessedOffset.toString()
        }
      }
    ).subscribe({
      next: (response) => {
        console.log('Replay response:', response);

        for (const event of response.events) {
          if (event.offset > this.lastProcessedOffset) {
            this.pendingEvents.set(event.offset, event);
          }
        }

        this.drainPendingEvents();

        this.replayInProgress = false;

        console.log(
          'Replay processing completed. Current offset:',
          this.lastProcessedOffset
        );
      },

      error: (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 410) {
          console.warn('Replay history expired. Reloading snapshot...');

          this.http.get<SnapshotResponse>(
            `${this.apiUrl}/metrics/snapshot`
          ).subscribe({
            next: (response) => {
              this.lastProcessedOffset = response.offset;
              this.pendingEvents.clear();
              this.lastProcessedSeq.clear();

              if (this.gapRecoveryTimer) {
                clearTimeout(this.gapRecoveryTimer);
                this.gapRecoveryTimer = null;
              }

              response.metrics.forEach((metric) => {
                this.metricSubject.next({
                  type: 'metric',
                  offset: response.offset,
                  serviceId: metric.serviceId,
                  seq: 0,
                  ts: metric.ts,
                  p95: metric.p95,
                  errRate: metric.errRate,
                  rps: metric.rps,
                  status: metric.status
                });
              });

              this.lastMetricAt = Date.now();
              this.replayInProgress = false;

              console.log(
                'Snapshot reloaded. Current offset:',
                this.lastProcessedOffset
              );
            },

            error: (snapshotError: unknown) => {
              console.error('Snapshot reload failed:', snapshotError);
              this.replayInProgress = false;
            }
          });

          return;
        }

        console.error('Metric replay failed:', error);
        this.replayInProgress = false;
      }
    });
  }

  private handleMetricEvent(event: MetricEvent): void {
    if (event.offset <= this.lastProcessedOffset) {
      this.duplicateEventCount.update(count => count + 1);
      return;
    }

    this.pendingEvents.set(event.offset, event);

    this.drainPendingEvents();
  }

}