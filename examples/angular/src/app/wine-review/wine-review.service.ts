import { Injectable } from '@angular/core';
import { InvokeDBClient, InvokeDBTable } from 'invokedb';
import { API_KEY } from 'src/invoke-config.json';

export interface IBaseFilterOpts {
  variety?: any;
  country?: any;
  priceRange?: Array<number>;
  pointRange?: Array<number>;
}

@Injectable({
  providedIn: 'root'
})
export class WineReviewService {
  private wineReviewTbl: InvokeDBTable;

  constructor() {
    const invokedbClient = new InvokeDBClient({ apiKey: API_KEY });
    this.wineReviewTbl = invokedbClient.table('winereview');
  }

  getPriceFilter(priceRange) {
    return [
      {
        $gte: priceRange[0]
      },
      {
        $lte: priceRange[1]
      }
    ];
  }

  getPointFilter(pointRange) {
    return [
      {
        $gte: pointRange[0]
      },
      {
        $lte: pointRange[1]
      }
    ];
  }

  getVarietyFilter(variety) {
    return {
      $ctn: variety.variety || variety
    };
  }

  getCountryFilter(country) {
    return {
      $ctn: country.country || country
    };
  }

  getBaseFilter(opts: IBaseFilterOpts) {
    const { variety, country, priceRange, pointRange } = opts;

    const filter: any = {};
    filter.price = this.getPriceFilter(priceRange);
    filter.points = this.getPointFilter(pointRange);

    if (variety) {
      filter.variety = this.getVarietyFilter(variety);
    }

    if (country) {
      filter.country = this.getCountryFilter(country);
    }

    return filter;
  }

  async getFilteredVarieties(filter) {
    const res = await this.wineReviewTbl
      .find(filter)
      .limit(1000)
      .sortBy('variety')
      .sortDir('asc')
      .exec();

    return res.data;
  }

  async getFilteredCountries(filter) {
    const res = await this.wineReviewTbl
      .find(filter)
      .limit(1000)
      .sortBy('country')
      .sortDir('asc')
      .exec();

    return res.data;
  }

  async getWines(filter, skip, limit, sortBy, sortDir) {
    return await this.wineReviewTbl
      .find(filter)
      .skip(skip)
      .limit(limit)
      .sortBy(sortBy)
      .sortDir(sortDir)
      .exec();
  }
}
