import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'todo', loadComponent: () => import('./todo/todo').then((m) => m.TodoPage) },
  {
    path: 'contacts',
    loadComponent: () => import('./contacts/contacts').then((m) => m.ContactsPage),
  },
  { path: 'wines', loadComponent: () => import('./wines/wines').then((m) => m.WinesPage) },
  { path: '**', redirectTo: 'todo' },
];
