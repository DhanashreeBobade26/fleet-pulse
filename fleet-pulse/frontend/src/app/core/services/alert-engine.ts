
import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';

import { Stream } from './stream';
import { Auth } from '../auth/auth';
import { MetricEvent } from '../models/metric-event.model';

type AlertMetric = 'p95' | 'errRate' | 'rps';
type AlertOperator = '>' | '>=' | '<' | '<=';

interface RuleCondition {
    metric: AlertMetric;
    operator: AlertOperator;
    threshold: number;
    durationSec: number;
}

interface AlertRule {
    id: string;
    name: string;
    conditions: RuleCondition[];
}

interface RulesResponse {
    total: number;
    rules: AlertRule[];
}

export interface AlertIncident {
    id: string;
    ruleId: string;
    ruleName: string;
    serviceId: string;
    message: string;
    triggeredAt: number;
    resolvedAt: number | null;
    status: 'active' | 'resolved';
}

@Injectable({
    providedIn: 'root'
})
export class AlertEngine {
    private readonly http = inject(HttpClient);
    private readonly stream = inject(Stream);
    private readonly auth = inject(Auth);

    private rules: AlertRule[] = [];
    private metricSubscription: Subscription | null = null;

    private readonly conditionStartTimes = new Map<string, number>();
    private readonly activeIncidents = new Set<string>();

    private rulesLoaded = false;
    private notificationShown = false;

    incidents = signal<AlertIncident[]>([]);
    rulesLoading = signal(false);
    rulesError = signal('');

    constructor() {
        this.metricSubscription = this.stream.metrics$.subscribe(event => {
            // Do not evaluate alerts when logged out.
            if (!this.auth.isLoggedIn()) {
                
                return;
            }

            if (!this.rulesLoaded) {
                this.refreshRules();
            }

            this.evaluateRules(event);
        });
    }

    refreshRules(): void {
        if (
            !this.auth.isLoggedIn() ||
            this.rulesLoaded ||
            this.rulesLoading()
        ) {
            return;
        }

        this.rulesLoading.set(true);
        this.rulesError.set('');

        this.http.get<RulesResponse>('http://localhost:4000/rules')
            .subscribe({
                next: response => {
                    this.rules = response.rules ?? [];
                    this.rulesLoaded = true;
                    this.rulesLoading.set(false);

                    console.log('Alert rules loaded:', this.rules.length);
                },
                error: error => {
                    this.rulesLoading.set(false);
                    this.rulesError.set('Unable to load alert rules.');

                    console.error('Failed to load alert rules:', error);
                }
            });
    }

    private evaluateRules(event: MetricEvent): void {
        if (!this.auth.isLoggedIn()) {
            return;
        }

        for (const rule of this.rules) {
            const incidentKey = `${rule.id}-${event.serviceId}`;

            let allConditionsTrue = true;
            let allConditionsMatured = true;

            rule.conditions.forEach((condition, index) => {
                const conditionKey =
                    `${rule.id}-${event.serviceId}-${index}`;

                const value = event[condition.metric];

                const isTrue = this.compare(
                    value,
                    condition.operator,
                    condition.threshold
                );

                if (!isTrue) {
                    this.conditionStartTimes.delete(conditionKey);
                    allConditionsTrue = false;
                    allConditionsMatured = false;
                    return;
                }

                if (!this.conditionStartTimes.has(conditionKey)) {
                    this.conditionStartTimes.set(conditionKey, Date.now());
                }

                const startedAt = this.conditionStartTimes.get(conditionKey)!;
                const elapsedSeconds = (Date.now() - startedAt) / 1000;

                if (elapsedSeconds < condition.durationSec) {
                    allConditionsMatured = false;
                }
            });

            if (!allConditionsTrue) {
                this.resolveIncident(incidentKey);
                continue;
            }

            if (
                allConditionsMatured &&
                !this.activeIncidents.has(incidentKey)
            ) {
                this.createIncident(rule, event, incidentKey);
            }
        }
    }

    private compare(
        value: number,
        operator: AlertOperator,
        threshold: number
    ): boolean {
        switch (operator) {
            case '>':
                return value > threshold;
            case '>=':
                return value >= threshold;
            case '<':
                return value < threshold;
            case '<=':
                return value <= threshold;
            default:
                return false;
        }
    }

    private createIncident(
        rule: AlertRule,
        event: MetricEvent,
        incidentKey: string
    ): void {
        if (!this.auth.isLoggedIn()) {
            return;
        }
        const incident: AlertIncident = {
            id: `${incidentKey}-${Date.now()}`,
            ruleId: rule.id,
            ruleName: rule.name,
            serviceId: event.serviceId,
            message: `${rule.name} triggered for ${event.serviceId}`,
            triggeredAt: Date.now(),
            resolvedAt: null,
            status: 'active'
        };

        this.activeIncidents.add(incidentKey);

        this.incidents.update(current => [
            incident,
            ...current
        ].slice(0, 100));

        console.warn('Alert incident triggered:', incident);

        // Show only one desktop notification per app session.
        if (
            'Notification' in window &&
            Notification.permission === 'granted' &&
            !this.notificationShown
        ) {
            this.notificationShown = true;

            new Notification('Fleet Pulse Alert', {
                body: 'New alert incidents detected. Check the Alert Incidents panel.',
                icon: '/favicon.ico'
            });
        }
    }

    private resolveIncident(incidentKey: string): void {
        if (!this.activeIncidents.has(incidentKey)) {
            return;
        }

        this.activeIncidents.delete(incidentKey);

        this.incidents.update(current =>
            current.map(incident => {
                if (
                    `${incident.ruleId}-${incident.serviceId}` === incidentKey &&
                    incident.status === 'active'
                ) {
                    return {
                        ...incident,
                        status: 'resolved',
                        resolvedAt: Date.now()
                    };
                }

                return incident;
            })
        );
    }

    dismissIncident(id: string): void {
        this.incidents.update(current =>
            current.filter(incident => incident.id !== id)
        );
    }
}
