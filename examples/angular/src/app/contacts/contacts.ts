import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { dateOnly, InvokeDB } from '../invokedb';

const TABLE = 'contacts';
const PAGE_SIZE = 12;

interface Contact {
  _id?: string;
  first_name: string;
  last_name: string;
  dob: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
}

const emptyContact = (): Contact => ({
  first_name: '',
  last_name: '',
  dob: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
});

/** A paged, searchable contact list with a create/edit/delete form ("contacts" table). */
@Component({
  selector: 'app-contacts',
  imports: [FormsModule],
  templateUrl: './contacts.html',
  styleUrl: './contacts.scss',
})
export class ContactsPage implements OnInit {
  private db = inject(InvokeDB);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;

  protected readonly contacts = signal<Contact[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly toast = signal<string | null>(null);
  protected readonly search = signal('');

  /** The contact shown in the form; `mode` says whether it's editable. */
  protected readonly selected = signal<Contact | null>(null);
  protected readonly mode = signal<'view' | 'edit' | 'new'>('view');
  protected readonly confirmingDelete = signal(false);
  protected draft: Contact = emptyContact();

  protected readonly pageSize = PAGE_SIZE;

  async ngOnInit() {
    await this.load();
    const first = this.contacts()[0];
    if (first) this.select(first);
  }

  protected pageCount() {
    return Math.max(1, Math.ceil(this.total() / PAGE_SIZE));
  }

  private async run(action: () => Promise<void>) {
    try {
      this.error.set(null);
      await action();
    } catch (e) {
      this.error.set(this.db.describeError(e, TABLE));
    } finally {
      this.loading.set(false);
    }
  }

  protected load() {
    this.loading.set(true);
    return this.run(async () => {
      const table = await this.db.table(TABLE);
      const text = this.search().trim();
      // $or matches rows where any of the listed columns match; $ctn is "contains".
      const filter = text
        ? { $or: { first_name: { $ctn: text }, last_name: { $ctn: text } } }
        : undefined;
      const res = await table
        .find(filter)
        .sortBy('last_name')
        .sortDir('asc')
        .skip(this.page() * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .exec();
      this.total.set(res.count);
      this.contacts.set(res.data.map((c: Contact) => ({ ...c, dob: dateOnly(c.dob) })));
    });
  }

  protected onSearch(text: string) {
    this.search.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(0);
      this.load();
    }, 300);
  }

  protected goTo(page: number) {
    this.page.set(Math.min(Math.max(page, 0), this.pageCount() - 1));
    this.load();
  }

  protected select(contact: Contact) {
    this.selected.set(contact);
    this.draft = { ...contact };
    this.mode.set('view');
    this.confirmingDelete.set(false);
  }

  protected startNew() {
    this.selected.set(null);
    this.draft = emptyContact();
    this.mode.set('new');
    this.confirmingDelete.set(false);
  }

  protected edit() {
    this.mode.set('edit');
  }

  protected cancel() {
    const current = this.selected();
    if (current) this.select(current);
    else this.mode.set('view');
  }

  protected save() {
    const isNew = this.mode() === 'new';
    const { _id, ...fields } = this.draft;
    const row = { ...fields, dob: fields.dob || null };
    return this.run(async () => {
      const table = await this.db.table(TABLE);
      if (isNew) {
        await table.insert(row);
        // Show the new contact: search for it by email (insert doesn't return the _id).
        this.search.set('');
        await this.load();
        const created = await table.findOne({ email: { $eq: row.email } }).exec();
        if (created) this.select({ ...created, dob: dateOnly(created.dob) });
        this.showToast('Contact created');
      } else {
        await table.update({ _id, ...row });
        await this.load();
        this.select({ ...this.draft });
        this.showToast('Contact updated');
      }
    });
  }

  protected remove() {
    const current = this.selected();
    if (!current?._id) return;
    return this.run(async () => {
      const table = await this.db.table(TABLE);
      await table.delete(current._id!);
      this.selected.set(null);
      this.draft = emptyContact();
      this.confirmingDelete.set(false);
      if (this.contacts().length === 1 && this.page() > 0) this.page.update((p) => p - 1);
      await this.load();
      this.showToast('Contact deleted');
    });
  }

  private showToast(message: string) {
    this.toast.set(message);
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.set(null), 2500);
  }
}
