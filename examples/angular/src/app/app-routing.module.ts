import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { ToDoAppComponent } from './to-do/to-do.component';
import { ContactFormComponent } from './contact-form/contact-form.component';
import { WineReviewComponent } from './wine-review/wine-review.component';

const routes: Routes = [
  {
    path: 'to-do',
    component: ToDoAppComponent
  },
  {
    path: 'contact-form',
    component: ContactFormComponent
  },
  {
    path: 'wine-review',
    component: WineReviewComponent
  },
  {
    path: '**',
    redirectTo: 'to-do',
    pathMatch: 'full'
  }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}
