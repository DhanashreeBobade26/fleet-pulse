
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
})
export class Settings implements OnInit {

  refreshInterval = 10;
  theme = 'light';

  ngOnInit(): void {
    const savedSettings = localStorage.getItem('fleetPulseSettings');

    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);

        if (
          typeof settings.refreshInterval === 'number' &&
          settings.refreshInterval >= 5 &&
          settings.refreshInterval <= 60
        ) {
          this.refreshInterval = settings.refreshInterval;
        }

        if (settings.theme === 'light' || settings.theme === 'dark') {
          this.theme = settings.theme;
        }

      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    }

    this.applyTheme();
  }

  saveSettings(): void {
    const settings = {
      refreshInterval: this.refreshInterval,
      theme: this.theme
    };

    localStorage.setItem(
      'fleetPulseSettings',
      JSON.stringify(settings)
    );

    this.applyTheme();

    console.log('Settings saved:', settings);
  }

  private applyTheme(): void {
    document.body.classList.remove('light-theme', 'dark-theme');

    document.body.classList.add(`${this.theme}-theme`);
  }
}
