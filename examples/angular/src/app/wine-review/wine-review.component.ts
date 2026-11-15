import { Component, ViewChild, AfterViewInit, OnInit } from '@angular/core';
import { WineReviewService, IBaseFilterOpts } from './wine-review.service';
import { VirtualScroller } from 'primeng/virtualscroller';

@Component({
  selector: 'app-wine-review',
  templateUrl: './wine-review.component.html',
  styleUrls: ['./wine-review.component.scss']
})
export class WineReviewComponent implements OnInit, AfterViewInit {
  priceRange = [0, 3300];
  pointRange = [87, 100];
  varietyText: any = '';
  countryText: any = '';
  filteredVarieties = [];
  filteredCountries = [];
  wines = [];
  totalWines = null;
  limit = 30;
  virtualScrollerRows = this.limit;
  loadWinesDebounceTimeout = null;
  loading = false;
  sortDir = 'asc';
  defaultSortBy = { label: 'Price', value: 'price' };
  sortBy;
  sortByOptions = [
    { label: 'Price', value: 'price' },
    { label: 'Points', value: 'points' },
    { label: 'Title', value: 'title' }
  ];

  @ViewChild('countryDropdown') countryDropdown: any;
  @ViewChild('vs') vs: VirtualScroller;
  constructor(private svc: WineReviewService) {}

  ngOnInit() {
    this.reset();
  }

  ngAfterViewInit() {
    this.removeBrowserAutocompletes();
  }

  removeBrowserAutocompletes() {
    this.countryDropdown.renderer.setAttribute(
      this.countryDropdown.inputEL.nativeElement,
      'autocomplete',
      'no'
    );
  }

  reset() {
    this.varietyText = '';
    this.countryText = '';
    this.sortBy = this.defaultSortBy;
    this.sortDir = 'asc';
    this.priceRange = [0, 3300];
    this.pointRange = [87, 100];
    if (this.vs) {
      this.vs.scrollToIndex(0);
    }
    this.loadWinesDebounce();
  }

  priceRangeChanged() {
    this.vs.scrollToIndex(0);
    this.loadWinesDebounce();
  }

  pointRangeChanged() {
    this.vs.scrollToIndex(0);
    this.loadWinesDebounce();
  }

  varietiesKeyUp(event) {
    if (this.varietyText === '' && event.key.indexOf('Arrow') < 0) {
      this.filterVarieties(true);
    }
  }

  countriesKeyUp(event) {
    if (this.varietyText === '' && event.key.indexOf('Arrow') < 0) {
      this.filterCountries(true);
    }
  }

  getBaseFilter() {
    const opts: IBaseFilterOpts = {
      variety: this.varietyText,
      country: this.countryText,
      priceRange: this.priceRange,
      pointRange: this.pointRange
    };
    return this.svc.getBaseFilter(opts);
  }

  async filterVarieties(reload?: true) {
    const filter = this.getBaseFilter();
    filter.$group = 'variety';

    this.filteredVarieties = await this.svc.getFilteredVarieties(filter);
    if (reload) {
      this.vs.scrollToIndex(0);
      this.loadWinesDebounce();
    }
  }

  async filterCountries(reload?: true) {
    const filter = this.getBaseFilter();
    filter.$group = 'country';

    this.filteredCountries = await this.svc.getFilteredCountries(filter);
    if (reload) {
      this.vs.scrollToIndex(0);
      this.loadWinesDebounce();
    }
  }

  toggleSortDir() {
    this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    this.vs.scrollToIndex(0);
    this.loadWinesDebounce();
  }

  loadWinesDebounce(event?) {
    this.loading = true;
    if (this.loadWinesDebounceTimeout) {
      window.clearTimeout(this.loadWinesDebounceTimeout);
    }
    this.loadWinesDebounceTimeout = window.setTimeout(
      () => this.loadWines(event),
      500
    );
  }

  async loadWines(event?) {
    let skip = 0;
    if (event && event.first !== 0) {
      skip = event.first - this.limit;
    }

    const filter = this.getBaseFilter();

    const res = await this.svc.getWines(
      filter,
      skip,
      this.limit,
      this.sortBy.value,
      this.sortDir
    );

    this.loading = false;
    this.loadWinesDebounceTimeout = null;
    this.onWineGetSuccess(res, skip, this.limit);
  }

  onWineGetSuccess(res: any, skip, limit) {
    this.vs.clearCache();
    this.wines = Array.from({ length: res.count });
    Array.prototype.splice.apply(this.wines, [...[skip, limit], ...res.data]);
    this.wines = [...this.wines];
    this.totalWines = res.count;
    this.virtualScrollerRows = res.count < this.limit ? res.count : this.limit;
  }
}
