export enum SORT_DIR {
  ASC = 'asc',
  DESC = 'desc'
}

export interface ISortParam {
  sortBy: string;
  sortDir: SORT_DIR;
}

export interface IGetParams {
  skip?: number;
  limit?: number;
  sort?: ISortParam;
}
