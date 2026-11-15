import { Component, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InvokeDB } from '../invokedb';

const TABLE = 'wine_reviews';
const PAGE_SIZE = 20;

interface Wine {
  _id: string;
  title: string;
  winery: string;
  variety: string;
  country: string;
  region: string;
  vintage: number;
  price: number;
  points: number;
  description: string;
}

interface Filters {
  minPrice: number | null;
  maxPrice: number | null;
  minPoints: number;
  variety: string;
  country: string;
  sortBy: 'points' | 'price' | 'vintage' | 'title';
  sortDir: 'asc' | 'desc';
}

const defaultFilters = (): Filters => ({
  minPrice: null,
  maxPrice: null,
  minPoints: 80,
  variety: '',
  country: '',
  sortBy: 'points',
  sortDir: 'desc',
});

/** Filter, sort and page through the "wine_reviews" table (number columns + $group). */
@Component({
  selector: 'app-wines',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './wines.html',
  styleUrl: './wines.scss',
})
export class WinesPage implements OnInit {
  private db = inject(InvokeDB);
  private timer?: ReturnType<typeof setTimeout>;
  private requestId = 0;

  protected readonly wines = signal<Wine[]>([]);
  protected readonly total = signal(0);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly varieties = signal<string[]>([]);
  protected readonly countries = signal<string[]>([]);
  protected filters: Filters = defaultFilters();

  async ngOnInit() {
    await Promise.all([this.loadOptions(), this.load()]);
  }

  /** The search filter for the current form values. Number columns take range operators. */
  private buildFilter() {
    const f = this.filters;
    const filter: Record<string, unknown> = {};
    const price: object[] = [];
    if (f.minPrice != null) price.push({ $gte: f.minPrice });
    if (f.maxPrice != null) price.push({ $lte: f.maxPrice });
    if (price.length) filter['price'] = price; // an array of conditions on one column = AND
    if (f.minPoints > 80) filter['points'] = { $gte: f.minPoints };
    if (f.variety) filter['variety'] = { $eq: f.variety };
    if (f.country) filter['country'] = { $eq: f.country };
    return Object.keys(filter).length ? filter : undefined;
  }

  /** $group returns the distinct values of one column, like SELECT DISTINCT. */
  private async loadOptions() {
    try {
      const table = await this.db.table(TABLE);
      const [v, c] = await Promise.all([
        table.find({ $group: 'variety' }).sortBy('variety').limit(500).exec(),
        table.find({ $group: 'country' }).sortBy('country').limit(500).exec(),
      ]);
      this.varieties.set(v.data.map((r: { variety: string }) => r.variety).filter(Boolean));
      this.countries.set(c.data.map((r: { country: string }) => r.country).filter(Boolean));
    } catch {
      // load() reports the error
    }
  }

  protected async load(append = false) {
    const id = ++this.requestId;
    this.loading.set(true);
    try {
      this.error.set(null);
      const table = await this.db.table(TABLE);
      const res = await table
        .find(this.buildFilter())
        .sortBy(this.filters.sortBy)
        .sortDir(this.filters.sortDir)
        .skip(append ? this.wines().length : 0)
        .limit(PAGE_SIZE)
        .exec();
      if (id !== this.requestId) return; // a newer search has started
      this.total.set(res.count);
      this.wines.set(append ? [...this.wines(), ...res.data] : res.data);
    } catch (e) {
      if (id === this.requestId) this.error.set(this.db.describeError(e, TABLE));
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  /** Re-run the search shortly after the user stops changing filters. */
  protected changed() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.load(), 300);
  }

  protected toggleDir() {
    this.filters.sortDir = this.filters.sortDir === 'asc' ? 'desc' : 'asc';
    this.load();
  }

  protected reset() {
    this.filters = defaultFilters();
    this.load();
  }
}
