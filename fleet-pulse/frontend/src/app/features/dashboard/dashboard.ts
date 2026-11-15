
import {
  Component,
  OnInit,
  ChangeDetectorRef,
  inject,
  OnDestroy
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { Fleet } from '../../core/services/fleet';
import { Service } from '../../core/models/service.model';
import { ActivatedRoute, Router } from '@angular/router';
import { Stream } from '../../core/services/stream';
import { MetricEvent } from '../../core/models/metric-event.model';
import { Subscription } from 'rxjs';
import { Auth } from '../../core/auth/auth';
import { IncidentPanel } from '../incident-panel/incident-panel';

type SortField = 'p95' | 'errRate' | 'rps';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatProgressSpinnerModule,
    IncidentPanel
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class Dashboard implements OnInit, OnDestroy {
  private readonly fleet = inject(Fleet);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly stream = inject(Stream);
  private readonly auth = inject(Auth);
  flashingServices = new Set<string>();

  private flashTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  get duplicateEventCount(): number {
    return this.stream.duplicateEventCount();
  }

  get malformedEventCount(): number {
    return this.stream.malformedEventCount();
  }

  get connectionStatus(): string {
    const status = this.stream.connectionStatus();

    switch (status) {
      case 'live-ws':
        return 'Live (WebSocket)';

      case 'live-sse':
        return 'Live (SSE)';

      case 'polling':
        return 'Polling';

      case 'reconnecting':
        return 'Reconnecting';

      case 'offline':
        return 'Offline';

      case 'stale':
        return 'Stale';

      default:
        return 'Unknown';
    }
  }
  private metricSubscription?: Subscription;

  services: Service[] = [];
  totalServices = 0;

  healthyCount = 0;
  warningCount = 0;
  criticalCount = 0;

  loading = false;
  errorMessage = '';

  // Search and filter
  searchTerm = '';
  selectedStatus = 'all';

  // Sorting
  sortField: SortField = 'p95';
  sortDirection: 'asc' | 'desc' = 'asc';

  // Pagination
  pageSize = 25;
  currentPage = 1;

  // Filter services using search and status.
  get filteredServices(): Service[] {
    const search = this.searchTerm.trim().toLowerCase();

    return this.services.filter(service => {
      const matchesSearch =
        service.id.toLowerCase().includes(search) ||
        service.name.toLowerCase().includes(search);

      const matchesStatus =
        this.selectedStatus === 'all' ||
        service.status === this.selectedStatus;

      return matchesSearch && matchesStatus;
    });
  }

  // Sort the filtered services.
  get sortedServices(): Service[] {
    return [...this.filteredServices].sort((a, b) => {
      const valueA = a[this.sortField];
      const valueB = b[this.sortField];

      const result = valueA - valueB;

      return this.sortDirection === 'asc' ? result : -result;
    });
  }

  // Total number of pages.
  get totalPages(): number {
    return Math.ceil(this.sortedServices.length / this.pageSize);
  }

  // Services displayed on the current page.
  get paginatedServices(): Service[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;

    return this.sortedServices.slice(
      startIndex,
      startIndex + this.pageSize
    );
  }

  get startRecord(): number {
    return this.sortedServices.length === 0
      ? 0
      : (this.currentPage - 1) * this.pageSize + 1;
  }

  get endRecord(): number {
    return Math.min(
      this.currentPage * this.pageSize,
      this.sortedServices.length
    );
  }

  ngOnInit(): void {
    this.stream.initializeOffset();
    this.metricSubscription = this.stream.metrics$.subscribe(
      (event: MetricEvent) => {
        if (!event) {
          console.warn('Received an empty metric event');
          return;
        }


        const index = this.services.findIndex(
          service => service.id === event.serviceId
        );

        if (index === -1) {
          return;
        }

        const previousService = this.services[index];

        if (previousService.status !== event.status) {
          this.updateStatusCount(previousService.status, -1);
          this.updateStatusCount(event.status, 1);

          this.flashingServices.add(event.serviceId);

          const existingTimeout = this.flashTimeouts.get(event.serviceId);

          if (existingTimeout) {
            clearTimeout(existingTimeout);
          }

          const timeout = setTimeout(() => {
            this.flashingServices.delete(event.serviceId);
            this.flashTimeouts.delete(event.serviceId);
            this.cdr.markForCheck();
          }, 700);

          this.flashTimeouts.set(event.serviceId, timeout);
        }

        this.services[index] = {
          ...previousService,
          p95: event.p95,
          errRate: event.errRate,
          rps: event.rps,
          status: event.status,
          updatedAt: event.ts
        };

        this.cdr.markForCheck();
      }
    );
    const params = this.route.snapshot.queryParamMap;

    this.searchTerm = params.get('q') ?? '';

    const status = params.get('status');

    if (
      status === 'healthy' ||
      status === 'warning' ||
      status === 'critical'
    ) {
      this.selectedStatus = status;
    }

    const sort = params.get('sort');

    if (sort === 'p95' || sort === 'errRate' || sort === 'rps') {
      this.sortField = sort;
    }

    const direction = params.get('direction');

    if (direction === 'asc' || direction === 'desc') {
      this.sortDirection = direction;
    }

    this.loadServices();
  }

  loadServices(): void {
    this.loading = true;
    this.errorMessage = '';

    this.cdr.markForCheck();

    this.fleet.getServices().subscribe({
      next: (response) => {
        this.services = response.services;
        this.totalServices = response.total;

        this.healthyCount = this.services.filter(
          service => service.status === 'healthy'
        ).length;

        this.warningCount = this.services.filter(
          service => service.status === 'warning'
        ).length;

        this.criticalCount = this.services.filter(
          service => service.status === 'critical'
        ).length;

        this.currentPage = 1;
        this.loading = false;

        this.cdr.markForCheck();
      },

      error: (error: unknown) => {
        console.error('Failed to load services:', error);

        this.errorMessage = 'Unable to load services. Please try again.';
        this.loading = false;

        this.cdr.markForCheck();
      }
    });
  }

  onSearchChange(value: string): void {
    this.searchTerm = value;
    this.currentPage = 1;
    this.updateUrlState();
  }

  onStatusChange(value: string): void {
    this.selectedStatus = value as
      'all' | 'healthy' | 'warning' | 'critical';

    this.currentPage = 1;
    this.updateUrlState();
  }

  sortBy(field: 'p95' | 'errRate' | 'rps'): void {
    if (this.sortField === field) {
      this.sortDirection =
        this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDirection = 'asc';
    }

    this.currentPage = 1;
    this.updateUrlState();
  }

  updateUrlState(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        q: this.searchTerm || null,
        status: this.selectedStatus === 'all'
          ? null
          : this.selectedStatus,
        sort: this.sortField,
        direction: this.sortDirection
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  openService(serviceId: string): void {
    this.router.navigate(['/services', serviceId]);
  }

  // Pagination.
  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) {
      return;
    }

    this.currentPage = page;
  }

  previousPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  private updateStatusCount(
    status: Service['status'],
    change: number
  ): void {
    switch (status) {
      case 'healthy':
        this.healthyCount += change;
        break;

      case 'warning':
        this.warningCount += change;
        break;

      case 'critical':
        this.criticalCount += change;
        break;
    }
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  ngOnDestroy(): void {
    this.metricSubscription?.unsubscribe();

    this.flashTimeouts.forEach(timeout => clearTimeout(timeout));
    this.flashTimeouts.clear();
    this.flashingServices.clear();
  }
}
