import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="top">
      <h1>InvokeDB Examples</h1>
      <nav>
        @for (link of links; track link.path) {
          <a [routerLink]="link.path" routerLinkActive="active">{{ link.label }}</a>
        }
      </nav>
    </header>
    <main>
      <router-outlet />
    </main>
  `,
  styleUrl: './app.scss',
})
export class App {
  protected readonly links = [
    { path: 'todo', label: 'To Do' },
    { path: 'contacts', label: 'Contacts' },
    { path: 'wines', label: 'Wine Reviews' },
  ];
}
