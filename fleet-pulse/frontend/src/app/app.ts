
import { Component, signal, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AlertEngine } from './core/services/alert-engine';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  protected readonly title = signal('frontend');

  private readonly alertEngine = inject(AlertEngine);

  ngOnInit(): void {
    this.applySavedTheme();
  }

  private applySavedTheme(): void {
    const savedSettings = localStorage.getItem('fleetPulseSettings');

    let theme = 'light';

    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);

        if (settings.theme === 'light' || settings.theme === 'dark') {
          theme = settings.theme;
        }
      } catch (error) {
        console.error('Failed to load application theme:', error);
      }
    }

    document.body.classList.remove('light-theme', 'dark-theme');
    document.body.classList.add(`${theme}-theme`);
  }
}
