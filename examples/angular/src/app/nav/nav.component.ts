import { Component, OnInit } from '@angular/core';
import { MenuItem } from 'primeng/api';

@Component({
  selector: 'app-nav',
  templateUrl: './nav.component.html',
  styleUrls: ['./nav.component.scss']
})
export class NavComponent implements OnInit {
  items: MenuItem[];

  constructor() {}

  ngOnInit(): void {
    this.items = [
      {
        label: 'To Do',
        icon: 'fa fa-list-alt',
        routerLink: 'to-do'
      },
      {
        label: 'Contact Form',
        icon: 'fa fa-user-edit',
        routerLink: 'contact-form'
      },
      {
        label: 'Wine Review',
        icon: 'fa fa-wine-glass-alt',
        routerLink: 'wine-review'
      }
    ];
  }
}
