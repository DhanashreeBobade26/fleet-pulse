
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Service, ServicesResponse } from '../models/service.model';
import { MetricHistoryResponse } from '../models/service.model';

@Injectable({
  providedIn: 'root'
})
export class Fleet {
  private readonly http = inject(HttpClient);

  private readonly apiUrl = 'http://localhost:4000/services';

  getServices(): Observable<ServicesResponse> {
    return this.http.get<ServicesResponse>(this.apiUrl);
  }
  getServiceById(id: string): Observable<Service> {
    return this.http.get<Service>(`${this.apiUrl}/${id}`);
  }
  getServiceHistory(
    serviceId: string,
    minutes: number = 15
  ): Observable<MetricHistoryResponse> {
    return this.http.get<MetricHistoryResponse>(
      `${this.apiUrl.replace('/services', '/metrics')}/history`,
      {
        params: {
          serviceId,
          minutes: minutes.toString()
        }
      }
    );
  }
}
