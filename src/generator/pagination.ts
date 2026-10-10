import { toUrl } from '../util/paths';

export interface PageSlice<T> {
  items: T[];
  page: number;
  totalPages: number;
  totalItems: number;
}

export function paginate<T>(items: readonly T[], perPage: number): PageSlice<T>[] {
  const size = Math.max(1, Math.floor(perPage) || 1);
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const slices: PageSlice<T>[] = [];
  for (let page = 1; page <= totalPages; page++) {
    slices.push({
      items: items.slice((page - 1) * size, page * size),
      page,
      totalPages,
      totalItems: items.length,
    });
  }
  return slices;
}

/** 第 1 页是站点根，其余为 /page/N/ */
export function defaultPageUrl(page: number): string {
  return page <= 1 ? '/' : `/page/${page}/`;
}

export interface PagerLink {
  page: number;
  url: string;
  current: boolean;
}

export interface Pager {
  current: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevUrl: string;
  nextUrl: string;
  links: PagerLink[];
}

export function buildPager(
  page: number,
  totalPages: number,
  urlForPage: (page: number) => string,
  window = 2,
): Pager {
  const links: PagerLink[] = [];
  for (let n = 1; n <= totalPages; n++) {
    const inWindow = Math.abs(n - page) <= window;
    const isEdge = n === 1 || n === totalPages;
    if (!inWindow && !isEdge) {
      const last = links[links.length - 1];
      if (last && last.page !== -1) links.push({ page: -1, url: '', current: false });
      continue;
    }
    links.push({ page: n, url: urlForPage(n), current: n === page });
  }

  return {
    current: page,
    total: totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    prevUrl: page > 1 ? urlForPage(page - 1) : '',
    nextUrl: page < totalPages ? urlForPage(page + 1) : '',
    links,
  };
}

/** 站点内路径：第 1 页是 baseUrl 根 */
export function indexPageUrl(page: number, baseUrl: string): string {
  return toUrl(defaultPageUrl(page), baseUrl);
}