import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { NgModule } from '@angular/core';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ScrollingModule } from '@angular/cdk/scrolling';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

import { CheckboxModule } from 'primeng/checkbox';
import { MenuModule } from 'primeng/menu';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ListboxModule } from 'primeng/listbox';
import { PaginatorModule } from 'primeng/paginator';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { VirtualScrollerModule } from 'primeng/virtualscroller';
import { SliderModule } from 'primeng/slider';
import { ChartModule } from 'primeng/chart';

import { HeaderComponent } from './header/header.component';
import { NavComponent } from './nav/nav.component';
import { ToDoAppComponent } from './to-do/to-do.component';
import { ContactFormComponent } from './contact-form/contact-form.component';
import { WineReviewComponent } from './wine-review/wine-review.component';

@NgModule({
  declarations: [
    AppComponent,
    HeaderComponent,
    NavComponent,
    ToDoAppComponent,
    ContactFormComponent,
    WineReviewComponent
  ],
  imports: [
    BrowserModule,
    BrowserAnimationsModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    ScrollingModule,
    AppRoutingModule,
    CheckboxModule,
    MenuModule,
    AutoCompleteModule,
    ButtonModule,
    InputTextModule,
    ListboxModule,
    PaginatorModule,
    ProgressSpinnerModule,
    VirtualScrollerModule,
    SliderModule,
    ChartModule
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule {}
