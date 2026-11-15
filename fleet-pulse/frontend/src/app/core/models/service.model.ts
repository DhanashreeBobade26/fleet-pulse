
export type ServiceStatus = 'healthy' | 'warning' | 'critical';

export interface Service {
  id: string;
  name: string;
  p95: number;
  errRate: number;
  rps: number;
  status: ServiceStatus;
  updatedAt: number;
}

export interface ServicesResponse {
  total: number;
  services: Service[];
}

export interface MetricHistoryPoint {
  ts: number;
  p95: number;
  errRate: number;
  rps: number;
}

export interface MetricHistoryResponse {
  serviceId: string;
  minutes: number;
  total: number;
  points: MetricHistoryPoint[];
}