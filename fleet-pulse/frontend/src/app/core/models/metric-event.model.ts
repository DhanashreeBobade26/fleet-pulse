import { ServiceStatus } from './service.model';

export interface MetricEvent {
  type: 'metric';
  offset: number;
  serviceId: string;
  seq: number;
  ts: number;
  p95: number;
  errRate: number;
  rps: number;
  status: ServiceStatus;
}

export type ConnectionStatus =
  | 'live-ws'
  | 'live-sse'
  | 'polling'
  | 'reconnecting'
  | 'offline'
  | 'stale';