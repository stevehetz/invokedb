import { Component, OnInit } from '@angular/core';
import { ContactFormService } from './contact-form.service';

@Component({
  selector: 'app-contact-form',
  templateUrl: './contact-form.component.html',
  styleUrls: ['./contact-form.component.scss']
})
export class ContactFormComponent implements OnInit {
  contacts = [];
  totalContacts = 0;
  searchText: string = null;
  searching = false;
  searchDebounce = null;
  contactSelected = false;
  selectedContactIndex: number = null;
  selectedContact: any = this.svc.newContact();
  loadingContacts = false;
  editing = false;
  adding = false;
  message = null;
  pageNumber = 0;
  pageSkip = 0;
  pageLimit = 10;

  constructor(private svc: ContactFormService) {}

  async ngOnInit() {
    await this.loadContacts();
    this.selectContact(this.contacts[0]);
  }

  async loadContacts() {
    this.loadingContacts = true;

    const res = await this.svc.get(
      this.searchText,
      this.pageSkip,
      this.pageLimit
    );

    this.totalContacts = res.count;
    this.contacts = res.data.map(c => this.formatContact(c));
    this.loadingContacts = false;
  }

  formatContact(contact) {
    contact = this.svc.formatDate(contact);
    contact = this.svc.addFullName(contact);
    return contact;
  }

  search() {
    this.loadingContacts = true;
    window.clearTimeout(this.searchDebounce);
    this.searchDebounce = window.setTimeout(async () => {
      await this.loadContacts();
    }, 500);
  }

  async paginate(event) {
    this.pageNumber = event.page;
    this.pageSkip = event.page * this.pageLimit;
    await this.loadContacts();
  }

  selectContact(event) {
    this.contactSelected = true;
    this.selectedContact = event.value || event;
    this.selectedContactIndex = null;
    this.contacts.forEach((c, i) => {
      if (c._id === this.selectedContact._id) {
        this.selectedContactIndex = i + this.pageSkip;
      }
    });
  }

  clearSelected() {
    this.contactSelected = false;
    this.selectedContact = this.svc.newContact();
  }

  addContact() {
    this.contactSelected = false;
    this.adding = true;
    this.selectedContact = this.svc.newContact();
  }

  editContact() {
    this.editing = true;
  }

  cancel() {
    this.adding = false;
    this.editing = false;
  }

  async deleteContact() {
    await this.svc.delete(this.selectedContact._id);
    await this.loadContacts();
    this.clearSelected();
    this.showMessage('Contact deleted');
  }

  async saveContact() {
    if (this.editing) {
      await this.updateContact(this.selectedContact);
    } else if (this.adding) {
      await this.createContact(this.selectedContact);
    }
  }

  async updateContact(contact) {
    await this.svc.update(contact);
    await this.loadContacts();

    contact = this.contacts.find(c => c._id === contact._id);
    this.selectContact(contact);
    this.showMessage('Contact updated');
    this.editing = false;
  }

  async createContact(contact) {
    this.goToLastPage();
    await this.svc.create(contact);
    await this.loadContacts();

    const index = this.contacts.length - 1;
    this.selectContact(this.contacts[index]);
    this.showMessage('Contact created');
    this.adding = false;
  }

  goToLastPage() {
    this.pageSkip =
      Math.floor(this.totalContacts / this.pageLimit) * this.pageLimit;
  }

  showMessage(msg) {
    this.message = msg;
    setTimeout(() => (this.message = null), 3000);
  }
}
