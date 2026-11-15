
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AlertEngine } from '../../core/services/alert-engine';

@Component({
  selector: 'app-incident-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './incident-panel.html',
  styleUrl: './incident-panel.scss'
})
export class IncidentPanel {
  readonly alertEngine = inject(AlertEngine);
  enableNotifications(): void {
  if ('Notification' in window) {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        alert('Browser notifications enabled!');
      } else {
        alert('Notification permission was not granted.');
      }
    });
  }
}
}
