
import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { Fleet } from '../../core/services/fleet';
import {
  Service,
  MetricHistoryPoint
} from '../../core/models/service.model';
import { BaseChartDirective } from 'ng2-charts';
import { ChartData, ChartOptions } from 'chart.js';

@Component({
  selector: 'app-service-detail',
  standalone: true,
  imports: [CommonModule, BaseChartDirective],
  templateUrl: './service-detail.html',
  styleUrl: './service-detail.scss'
})
export class ServiceDetail implements OnInit {

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fleet = inject(Fleet);
  private readonly cdr = inject(ChangeDetectorRef);

  historyPoints: MetricHistoryPoint[] = [];
  historyLoading = false;
  historyError = '';

  service: Service | null = null;
  loading = false;
  errorMessage = '';
  private currentRequestId = 0;
  p95ChartData: ChartData<'line'> = {
    labels: [],
    datasets: [
      {
        label: 'P95 Latency',
        data: [],
        tension: 0.3
      }
    ]
  };

  errorChartData: ChartData<'line'> = {
    labels: [],
    datasets: [
      {
        label: 'Error Rate',
        data: [],
        tension: 0.3
      }
    ]
  };

  rpsChartData: ChartData<'line'> = {
    labels: [],
    datasets: [
      {
        label: 'Requests Per Second',
        data: [],
        tension: 0.3
      }
    ]
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
    this.route.paramMap.subscribe(params => {
      const serviceId = params.get('id');

      if (!serviceId) {
        this.errorMessage = 'Service ID is missing.';
        return;
      }

      this.loadService(serviceId);
    });
  }

  loadService(serviceId: string): void {
    const requestId = ++this.currentRequestId;

    this.loading = true;
    this.errorMessage = '';
    this.service = null;

    this.loadServiceHistory(serviceId, requestId);

    this.fleet.getServiceById(serviceId).subscribe({
      next: (response) => {
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
  this.historyPoints = [];

  this.fleet.getServiceHistory(serviceId, 15).subscribe({
    next: (response) => {
      if (requestId !== this.currentRequestId) {
        return;
      }

      this.historyPoints = this.reduceHistoryPoints(response.points);
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

  retryHistory(): void {
  const serviceId = this.route.snapshot.paramMap.get('id');

  if (!serviceId) {
    return;
  }

  this.loadServiceHistory(serviceId, this.currentRequestId);
}

  goBack(): void {
    this.router.navigate(['/dashboard']);
  }
}
