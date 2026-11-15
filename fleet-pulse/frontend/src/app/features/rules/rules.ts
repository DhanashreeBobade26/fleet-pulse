
import {
  Component,
  OnInit,
  inject,
  ChangeDetectorRef
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';

import {
  AbstractControl,
  AsyncValidatorFn,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';

import {
  catchError,
  map,
  of,
  switchMap,
  take,
  timer
} from 'rxjs';
import { Auth } from '../../core/auth/auth';

type Metric = 'p95' | 'errRate' | 'rps';
type Operator = '>' | '>=' | '<' | '<=';

interface AlertCondition {
  metric: Metric;
  operator: Operator;
  threshold: number;
  durationSec: number;
}

interface AlertRule {
  id: string;
  name: string;
  conditions: AlertCondition[];
  createdAt: string;
  updatedAt: string;
  idempotencyKey?: string;
}

interface RulesResponse {
  total: number;
  rules: AlertRule[];
}

interface NameCheckResponse {
  available: boolean;
  message: string;
}

type ConditionForm = FormGroup<{
  metric: FormControl<Metric>;
  operator: FormControl<Operator>;
  threshold: FormControl<number>;
  durationSec: FormControl<number>;
}>;

type RulesForm = FormGroup<{
  name: FormControl<string>;
  warningThreshold: FormControl<number>;
  criticalThreshold: FormControl<number>;
  conditions: FormArray<ConditionForm>;
}>;

@Component({
  selector: 'app-rules',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule
  ],
  templateUrl: './rules.html',
  styleUrl: './rules.scss'
})
export class Rules implements OnInit {

  private http = inject(HttpClient);
  private fb = inject(FormBuilder);
  private cdr = inject(ChangeDetectorRef);
  private auth = inject(Auth);

  private readonly apiUrl = 'http://localhost:4000';

  get isOperator(): boolean {
    return this.auth.hasRole('operator');
  }

  rules: AlertRule[] = [];

  loading = false;
  saving = false;

  errorMessage = '';
  successMessage = '';

  editingRuleId: string | null = null;

  private originalRule: AlertRule | null = null;

  readonly metrics: { value: Metric; label: string }[] = [
    { value: 'p95', label: 'Latency (p95) - milliseconds' },
    { value: 'errRate', label: 'Error Rate - percentage' },
    { value: 'rps', label: 'Requests Per Second' }
  ];

  readonly operators: Operator[] = ['>', '>=', '<', '<='];

  readonly form: RulesForm = this.fb.nonNullable.group(
    {
      name: this.fb.nonNullable.control('', {
        validators: [
          Validators.required,
          Validators.maxLength(60)
        ],
        asyncValidators: [this.uniqueNameValidator()]
      }),

      warningThreshold: this.fb.nonNullable.control(70, [
        Validators.required,
        Validators.min(0)
      ]),

      criticalThreshold: this.fb.nonNullable.control(90, [
        Validators.required,
        Validators.min(0)
      ]),

      conditions: this.fb.array<ConditionForm>([
        this.createCondition()
      ])
    },
    {
      validators: [this.thresholdComparisonValidator()]
    }
  );

  ngOnInit(): void {
    this.loadRules();
  }

  get conditions(): FormArray<ConditionForm> {
    return this.form.controls.conditions;
  }

  createCondition(): ConditionForm {
    return this.fb.nonNullable.group(
      {
        metric: this.fb.nonNullable.control<Metric>('p95'),
        operator: this.fb.nonNullable.control<Operator>('>'),
        threshold: this.fb.nonNullable.control(500, [
          Validators.required,
          Validators.min(0)
        ]),
        durationSec: this.fb.nonNullable.control(60, [
          Validators.required,
          this.durationValidator()
        ])
      },
      {
        validators: this.conditionValidator()
      }
    );
  }

  addCondition(): void {
    if (!this.isOperator) return;

    this.conditions.push(this.createCondition());
    this.cdr.markForCheck();
  }

  removeCondition(index: number): void {
    if (!this.isOperator) return;

    if (this.conditions.length > 1) {
      this.conditions.removeAt(index);
      this.cdr.markForCheck();
    }
  }

  private thresholdComparisonValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const warning = Number(control.get('warningThreshold')?.value);
      const critical = Number(control.get('criticalThreshold')?.value);

      if (!Number.isFinite(warning) || !Number.isFinite(critical)) {
        return null;
      }

      return warning < critical
        ? null
        : { invalidThresholdComparison: true };
    };
  }

  private durationValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = Number(control.value);

      return Number.isInteger(value) && value >= 0
        ? null
        : { invalidDuration: true };
    };
  }

  private conditionValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const metric = control.get('metric')?.value as Metric;
      const threshold = Number(control.get('threshold')?.value);

      if (!Number.isFinite(threshold) || threshold < 0) {
        return { invalidThreshold: true };
      }

      if (metric === 'errRate' && threshold > 100) {
        return { thresholdOutOfRange: true };
      }

      return null;
    };
  }

  private uniqueNameValidator(): AsyncValidatorFn {
    return (control: AbstractControl) => {
      const name = String(control.value || '').trim();

      if (!name) {
        return of(null);
      }

      const params: Record<string, string> = { name };

      if (this.editingRuleId) {
        params['excludeId'] = this.editingRuleId;
      }

      return timer(400).pipe(
        switchMap(() =>
          this.http.get<NameCheckResponse>(
            `${this.apiUrl}/rules/check-name`,
            { params }
          )
        ),
        map(response =>
          response.available ? null : { duplicateName: true }
        ),
        catchError(() => of(null)),
        take(1)
      );
    };
  }

  loadRules(): void {
    this.loading = true;
    this.errorMessage = '';

    this.http.get<RulesResponse>(
      `${this.apiUrl}/rules`
    ).subscribe({
      next: (response) => {
        this.rules = response.rules ?? [];
        this.loading = false;
        this.cdr.markForCheck();
      },

      error: (error) => {
        this.errorMessage =
          error.error?.error?.message || 'Unable to load rules';

        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  editRule(rule: AlertRule): void {
    if (!this.isOperator) return;

    this.errorMessage = '';
    this.successMessage = '';

    this.editingRuleId = rule.id;

    this.originalRule = {
      ...rule,
      conditions: rule.conditions.map(condition => ({ ...condition }))
    };

    this.form.controls.name.setValue(rule.name);

    this.form.controls.warningThreshold.setValue(70);
    this.form.controls.criticalThreshold.setValue(90);

    this.conditions.clear();

    rule.conditions.forEach(condition => {
      const conditionForm = this.createCondition();

      conditionForm.patchValue({
        metric: condition.metric,
        operator: condition.operator,
        threshold: condition.threshold,
        durationSec: condition.durationSec
      });

      this.conditions.push(conditionForm);
    });

    this.form.markAsPristine();
    this.cdr.markForCheck();
  }

  saveRule(): void {
    if (!this.isOperator) return;

    this.errorMessage = '';
    this.successMessage = '';

    if (this.form.invalid || this.form.pending || this.saving) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.editingRuleId) {
      this.updateRule();
    } else {
      this.createRule();
    }
  }

  createRule(): void {
    if (!this.isOperator) return;

    if (this.form.invalid || this.form.pending || this.saving) {
      this.form.markAllAsTouched();
      return;
    }

    const formValue = this.form.getRawValue();

    const conditions: AlertCondition[] = formValue.conditions.map(
      condition => ({
        metric: condition.metric,
        operator: condition.operator,
        threshold: Number(condition.threshold),
        durationSec: Number(condition.durationSec)
      })
    );

    const idempotencyKey = crypto.randomUUID();
    const now = new Date().toISOString();

    const optimisticRule: AlertRule = {
      id: `temp-${idempotencyKey}`,
      name: formValue.name.trim(),
      conditions,
      createdAt: now,
      updatedAt: now
    };

    this.rules = [optimisticRule, ...this.rules];
    this.saving = true;
    this.cdr.markForCheck();

    const headers = new HttpHeaders({
      'Idempotency-Key': idempotencyKey
    });

    this.http.post<AlertRule>(
      `${this.apiUrl}/rules`,
      {
        name: optimisticRule.name,
        conditions
      },
      { headers }
    ).subscribe({
      next: (savedRule) => {
        this.rules = this.rules.map(rule =>
          rule.id === optimisticRule.id ? savedRule : rule
        );

        this.saving = false;
        this.successMessage = 'Alert rule created successfully';

        this.resetForm();
        this.cdr.markForCheck();
      },

      error: (error) => {
        this.rules = this.rules.filter(
          rule => rule.id !== optimisticRule.id
        );

        this.saving = false;
        this.errorMessage =
          error.error?.error?.message || 'Unable to create alert rule';

        this.cdr.markForCheck();
      }
    });
  }

  private updateRule(): void {
    if (!this.isOperator || !this.editingRuleId) {
      return;
    }

    const ruleId = this.editingRuleId;
    const formValue = this.form.getRawValue();

    const conditions: AlertCondition[] = formValue.conditions.map(
      condition => ({
        metric: condition.metric,
        operator: condition.operator,
        threshold: Number(condition.threshold),
        durationSec: Number(condition.durationSec)
      })
    );

    const existingRule = this.rules.find(rule => rule.id === ruleId);

    if (!existingRule) {
      this.errorMessage = 'Rule not found';
      return;
    }

    const previousRule: AlertRule = {
      ...existingRule,
      conditions: existingRule.conditions.map(condition => ({ ...condition }))
    };

    const optimisticRule: AlertRule = {
      ...existingRule,
      name: formValue.name.trim(),
      conditions,
      updatedAt: new Date().toISOString()
    };

    this.rules = this.rules.map(rule =>
      rule.id === ruleId ? optimisticRule : rule
    );

    this.saving = true;
    this.cdr.markForCheck();

    this.http.put<AlertRule>(
      `${this.apiUrl}/rules/${ruleId}`,
      {
        name: optimisticRule.name,
        conditions
      }
    ).subscribe({
      next: (updatedRule) => {
        this.rules = this.rules.map(rule =>
          rule.id === ruleId ? updatedRule : rule
        );

        this.saving = false;
        this.successMessage = 'Alert rule updated successfully';

        this.resetForm();
        this.cdr.markForCheck();
      },

      error: (error) => {
        this.rules = this.rules.map(rule =>
          rule.id === ruleId ? previousRule : rule
        );

        this.saving = false;
        this.errorMessage =
          error.error?.error?.message || 'Unable to update alert rule';

        this.cdr.markForCheck();
      }
    });
  }

  cancelEdit(): void {
    if (!this.isOperator) return;

    if (this.form.dirty) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to cancel editing?'
      );

      if (!confirmed) {
        return;
      }
    }

    this.resetForm();
  }

  private resetForm(): void {
    this.editingRuleId = null;
    this.originalRule = null;

    this.form.controls.name.reset('');
    this.form.controls.warningThreshold.setValue(70);
    this.form.controls.criticalThreshold.setValue(90);

    this.conditions.clear();
    this.conditions.push(this.createCondition());

    this.form.markAsPristine();
    this.form.markAsUntouched();
  }
}
