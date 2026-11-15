
import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectorRef,
  inject
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { Fleet } from '../../core/services/fleet';
import { Stream } from '../../core/services/stream';

import {
  Service,
  MetricHistoryPoint
} from '../../core/models/service.model';

import { MetricEvent } from '../../core/models/metric-event.model';

import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions } from 'chart.js';

@Component({
  selector: 'app-service-detail',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  templateUrl: './service-detail.html',
  styleUrl: './service-detail.scss'
})
export class ServiceDetail implements OnInit, OnDestroy {

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fleet = inject(Fleet);
  private readonly stream = inject(Stream);
  private readonly cdr = inject(ChangeDetectorRef);

  private routeSubscription?: Subscription;
  private metricSubscription?: Subscription;

  private currentRequestId = 0;
  private activeServiceId: string | null = null;
  private historyLoaded = false;
  private livePoints: MetricHistoryPoint[] = [];

  historyPoints: MetricHistoryPoint[] = [];
  historyLoading = false;
  historyError = '';

  service: Service | null = null;
  loading = false;
  errorMessage = '';

  p95ChartData: ChartData<'line'> = {
    labels: [],
    datasets: [{
      label: 'P95 Latency',
      data: [],
      tension: 0.3
    }]
  };

  errorChartData: ChartData<'line'> = {
    labels: [],
    datasets: [{
      label: 'Error Rate',
      data: [],
      tension: 0.3
    }]
  };

  rpsChartData: ChartData<'line'> = {
    labels: [],
    datasets: [{
      label: 'Requests Per Second',
      data: [],
      tension: 0.3
    }]
  };

  chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: {
        display: false
      }
    },
    scales: {
      y: {
        beginAtZero: true
      }
    }
  };

  ngOnInit(): void {
    this.routeSubscription = this.route.paramMap.subscribe(params => {
      const serviceId = params.get('id');

      if (!serviceId) {
        this.errorMessage = 'Service ID is missing.';
        return;
      }

      this.loadService(serviceId);
    });

    this.metricSubscription = this.stream.metrics$.subscribe(
      (event: MetricEvent) => {
        if (!event || event.serviceId !== this.activeServiceId) {
          return;
        }

        const livePoint: MetricHistoryPoint = {
          ts: event.ts,
          p95: event.p95,
          errRate: event.errRate,
          rps: event.rps
        };

        this.livePoints.push(livePoint);

        if (this.livePoints.length > 300) {
          this.livePoints.shift();
        }

        if (this.historyLoaded) {
          this.historyPoints = this.reduceHistoryPoints([
            ...this.historyPoints,
            livePoint
          ]);

          this.updateCharts();
        }

        if (this.service) {
          this.service = {
            ...this.service,
            p95: event.p95,
            errRate: event.errRate,
            rps: event.rps,
            status: event.status,
            updatedAt: event.ts
          };
        }

        this.cdr.markForCheck();
      }
    );
  }

  loadService(serviceId: string): void {
    const requestId = ++this.currentRequestId;

    this.activeServiceId = serviceId;
    this.historyLoaded = false;
    this.livePoints = [];
    this.historyPoints = [];

    this.clearCharts();

    this.loading = true;
    this.errorMessage = '';
    this.historyError = '';
    this.historyLoading = true;
    this.service = null;

    this.loadServiceHistory(serviceId, requestId);

    this.fleet.getServiceById(serviceId).subscribe({
      next: response => {
        if (requestId !== this.currentRequestId) {
          return;
        }

        this.service = response;
        this.loading = false;
        this.cdr.markForCheck();
      },

      error: (error: unknown) => {
        if (requestId !== this.currentRequestId) {
          return;
        }

        console.error('Failed to load service:', error);

        this.errorMessage = 'Unable to load service details.';
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  loadServiceHistory(serviceId: string, requestId: number): void {
    this.historyLoading = true;
    this.historyError = '';

    this.fleet.getServiceHistory(serviceId, 15).subscribe({
      next: response => {
        if (requestId !== this.currentRequestId) {
          return;
        }

        this.historyPoints = this.reduceHistoryPoints([
          ...response.points,
          ...this.livePoints
        ]);

        this.historyLoaded = true;
        this.updateCharts();

        this.historyLoading = false;
        this.cdr.markForCheck();

        console.log('History points loaded:', response.total);
      },

      error: (error: unknown) => {
        if (requestId !== this.currentRequestId) {
          return;
        }

        console.error('Failed to load service history:', error);

        this.historyError = 'Unable to load historical metrics.';
        this.historyLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  reduceHistoryPoints(
    points: MetricHistoryPoint[],
    maxPoints: number = 300
  ): MetricHistoryPoint[] {

    if (points.length <= maxPoints) {
      return points;
    }

    const reducedPoints: MetricHistoryPoint[] = [];
    const interval = (points.length - 1) / (maxPoints - 1);

    for (let i = 0; i < maxPoints; i++) {
      const index = Math.round(i * interval);
      reducedPoints.push(points[index]);
    }

    return reducedPoints;
  }

  updateCharts(): void {
    const labels = this.historyPoints.map(point =>
      new Date(point.ts).toLocaleTimeString()
    );

    this.p95ChartData = {
      labels,
      datasets: [{
        label: 'P95 Latency',
        data: this.historyPoints.map(point => point.p95),
        tension: 0.3
      }]
    };

    this.errorChartData = {
      labels,
      datasets: [{
        label: 'Error Rate',
        data: this.historyPoints.map(point => point.errRate),
        tension: 0.3
      }]
    };

    this.rpsChartData = {
      labels,
      datasets: [{
        label: 'Requests Per Second',
        data: this.historyPoints.map(point => point.rps),
        tension: 0.3
      }]
    };
  }

  private clearCharts(): void {
    this.p95ChartData = {
      labels: [],
      datasets: [{
        label: 'P95 Latency',
        data: []
      }]
    };

    this.errorChartData = {
      labels: [],
      datasets: [{
        label: 'Error Rate',
        data: []
      }]
    };

    this.rpsChartData = {
      labels: [],
      datasets: [{
        label: 'Requests Per Second',
        data: []
      }]
    };
  }

  retryHistory(): void {
    const serviceId = this.activeServiceId;

    if (!serviceId) {
      return;
    }

    this.historyLoaded = false;
    this.livePoints = [];

    this.loadServiceHistory(serviceId, this.currentRequestId);
  }

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.metricSubscription?.unsubscribe();
  }
}
