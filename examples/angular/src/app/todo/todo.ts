import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { dateOnly, InvokeDB } from '../invokedb';

const TABLE = 'todo';

interface Todo {
  _id: string;
  name: string;
  is_complete: 'yes' | 'no';
  priority: 'low' | 'medium' | 'high';
  due_date: string | null;
}

/** A to-do list: find (with a filter), insert, update and delete on the "todo" table. */
@Component({
  selector: 'app-todo',
  imports: [FormsModule],
  templateUrl: './todo.html',
  styleUrl: './todo.scss',
})
export class TodoPage implements OnInit {
  private db = inject(InvokeDB);

  protected readonly items = signal<Todo[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly showCompleted = signal(true);
  protected readonly editingId = signal<string | null>(null);
  protected readonly openCount = computed(
    () => this.items().filter((i) => i.is_complete === 'no').length,
  );

  protected newName = signal('');
  protected newPriority = signal<Todo['priority']>('medium');
  protected newDue = signal('');
  protected editName = signal('');

  protected readonly dateOnly = dateOnly;

  private editInput = viewChild<ElementRef<HTMLInputElement>>('editInput');

  constructor() {
    // Focus the rename box when it appears.
    effect(() => this.editInput()?.nativeElement.focus());
  }

  async ngOnInit() {
    await this.load();
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
    return this.run(async () => {
      const table = await this.db.table(TABLE);
      // No filter returns every row; a filter object sends a search instead.
      const filter = this.showCompleted() ? undefined : { is_complete: { $eq: 'no' } };
      const res = await table.find(filter).sortBy('due_date').sortDir('asc').limit(200).exec();
      this.items.set(res.data);
    });
  }

  protected toggleShowCompleted() {
    this.showCompleted.update((v) => !v);
    this.load();
  }

  protected add() {
    const name = this.newName().trim();
    if (!name) return;
    return this.run(async () => {
      const table = await this.db.table(TABLE);
      await table.insert({
        name,
        is_complete: 'no',
        priority: this.newPriority(),
        due_date: this.newDue() || null,
      });
      this.newName.set('');
      this.newDue.set('');
      await this.load();
    });
  }

  protected toggle(item: Todo) {
    const is_complete = item.is_complete === 'yes' ? 'no' : 'yes';
    this.patchLocal(item._id, { is_complete });
    return this.run(async () => {
      const table = await this.db.table(TABLE);
      await table.update({ _id: item._id, is_complete });
      if (!this.showCompleted() && is_complete === 'yes') {
        this.items.update((list) => list.filter((i) => i._id !== item._id));
      }
    });
  }

  protected startEdit(item: Todo) {
    this.editingId.set(item._id);
    this.editName.set(item.name);
  }

  protected saveEdit(item: Todo) {
    // Enter saves and removes the input, which then fires blur: only save once.
    if (this.editingId() !== item._id) return;
    const name = this.editName().trim();
    this.editingId.set(null);
    if (!name || name === item.name) return;
    this.patchLocal(item._id, { name });
    return this.run(async () => {
      const table = await this.db.table(TABLE);
      await table.update({ _id: item._id, name });
    });
  }

  protected remove(item: Todo) {
    this.items.update((list) => list.filter((i) => i._id !== item._id));
    return this.run(async () => {
      const table = await this.db.table(TABLE);
      await table.delete(item._id);
    });
  }

  protected isOverdue(item: Todo) {
    const due = dateOnly(item.due_date);
    return item.is_complete === 'no' && !!due && due < new Date().toISOString().slice(0, 10);
  }

  private patchLocal(id: string, patch: Partial<Todo>) {
    this.items.update((list) => list.map((i) => (i._id === id ? { ...i, ...patch } : i)));
  }
}
