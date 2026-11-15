
import { Routes } from '@angular/router';

import { rulesGuard } from './core/auth/rules.guard';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [

  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login').then(m => m.Login)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard').then(m => m.Dashboard)
  },
  {
    path: 'services/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/service-detail/service-detail')
        .then(m => m.ServiceDetail)
  },
  {
    path: 'rules',
    canActivate: [rulesGuard],
    loadComponent: () =>
      import('./features/rules/rules').then(m => m.Rules)
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/settings').then(m => m.Settings)
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: '**',
    redirectTo: 'login'
  }
];
