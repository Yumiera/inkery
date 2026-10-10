import type { PageEntry, PostEntry, TaxonomyIndex, TaxonomyTerm } from '../content/model';
import { toUrl, urlJoin, urlToRelPath } from '../util/paths';
import { paginate } from './pagination';

export type TaxonomyKind = 'tags' | 'categories';

export interface IndexRoute {
  kind: 'index';
  url: string;
  outPath: string;
  page: number;
  totalPages: number;
  slugs: string[];
}

export interface ArchiveRoute {
  kind: 'archive';
  url: string;
  outPath: string;
  slugs: string[];
}

export interface TaxonomyRoute {
  kind: 'taxonomy';
  url: string;
  outPath: string;
  taxonomy: TaxonomyKind;
  terms: TaxonomyTerm[];
}

export interface TermRoute {
  kind: 'term';
  url: string;
  outPath: string;
  taxonomy: TaxonomyKind;
  term: TaxonomyTerm;
  page: number;
  totalPages: number;
  slugs: string[];
}

export interface PostRoute {
  kind: 'post';
  url: string;
  outPath: string;
  slug: string;
}

export interface PageRoute {
  kind: 'page';
  url: string;
  outPath: string;
  pathname: string;
}

export interface NotFoundRoute {
  kind: 'notfound';
  url: string;
  outPath: string;
}

export interface AliasRoute {
  kind: 'alias';
  url: string;
  outPath: string;
  target: string;
}

export type RoutePlan =
  | IndexRoute
  | ArchiveRoute
  | TaxonomyRoute
  | TermRoute
  | PostRoute
  | PageRoute
  | NotFoundRoute
  | AliasRoute;

export interface RouteInput {
  baseUrl: string;
  permalinkPattern: string;
  postsPerPage: number;
  /** 进入首页/归档/标签/分类列表的文章（已排除 hidden 与 scheduled） */
  listed: PostEntry[];
  /** 需要生成页面但不出现在列表中的文章（hidden） */
  hidden: PostEntry[];
  pages: PageEntry[];
}

/** URL → dist 内文件路径：以 `/` 结尾视为目录型 URL，落到 index.html */
export function outPathFor(url: string): string {
  const rel = urlToRelPath(url);
  if (rel === '') return 'index.html';
  if (url.endsWith('/')) return `${rel}index.html`;
  return rel;
}

export function termUrl(taxonomy: TaxonomyKind, slug: string, page = 1, baseUrl = '/'): string {
  const base = `/${taxonomy}/${slug}/`;
  const target = page <= 1 ? base : urlJoin(base, `page/${page}/`);
  return toUrl(target, baseUrl);
}

export function taxonomyIndexUrl(taxonomy: TaxonomyKind, baseUrl = '/'): string {
  return toUrl(`/${taxonomy}/`, baseUrl);
}

export function archiveUrl(baseUrl = '/'): string {
  return toUrl('/archives/', baseUrl);
}

export function planRoutes(input: RouteInput): RoutePlan[] {
  const { baseUrl, permalinkPattern, postsPerPage, listed, hidden, pages } = input;
  const routes: RoutePlan[] = [];

  const indexPages = paginate(listed, postsPerPage);
  for (const slice of indexPages) {
    const url = toUrl(slice.page <= 1 ? '/' : `/page/${slice.page}/`, baseUrl);
    routes.push({
      kind: 'index',
      url,
      outPath: outPathFor(url),
      page: slice.page,
      totalPages: slice.totalPages,
      slugs: slice.items.map((p) => p.frontmatter.slug),
    });
  }

  routes.push({
    kind: 'archive',
    url: archiveUrl(baseUrl),
    outPath: outPathFor(archiveUrl(baseUrl)),
    slugs: listed.map((p) => p.frontmatter.slug),
  });

  for (const post of [...listed, ...hidden]) {
    const url = post.derived.url;
    routes.push({ kind: 'post', url, outPath: outPathFor(url), slug: post.frontmatter.slug });
  }

  for (const page of pages) {
    routes.push({
      kind: 'page',
      url: page.url,
      outPath: outPathFor(page.url),
      pathname: page.pathname,
    });
  }

  routes.push({ kind: 'notfound', url: toUrl('/404.html', baseUrl), outPath: '404.html' });

  for (const post of [...listed, ...hidden]) {
    for (const alias of post.frontmatter.aliases ?? []) {
      const name = alias.trim();
      if (name === '' || name === post.frontmatter.slug) continue;
      const url = toUrl(permalinkPattern.replace(/:slug/g, name), baseUrl);
      if (routes.some((route) => route.url === url)) continue;
      routes.push({ kind: 'alias', url, outPath: outPathFor(url), target: post.derived.url });
    }
  }

  return routes;
}

export function planTaxonomyRoutes(
  taxonomy: TaxonomyIndex,
  listed: PostEntry[],
  baseUrl: string,
  postsPerPage: number,
): RoutePlan[] {
  const routes: RoutePlan[] = [];
  const groups: Array<{ kind: TaxonomyKind; terms: TaxonomyTerm[] }> = [
    { kind: 'tags', terms: taxonomy.tags },
    { kind: 'categories', terms: taxonomy.categories },
  ];

  for (const group of groups) {
    const indexUrl = taxonomyIndexUrl(group.kind, baseUrl);
    routes.push({
      kind: 'taxonomy',
      url: indexUrl,
      outPath: outPathFor(indexUrl),
      taxonomy: group.kind,
      terms: group.terms,
    });

    for (const term of group.terms) {
      const matched = listed.filter((post) =>
        (group.kind === 'tags' ? post.frontmatter.tags : post.frontmatter.categories)?.includes(term.name),
      );
      for (const slice of paginate(matched, postsPerPage)) {
        const url = termUrl(group.kind, term.slug, slice.page, baseUrl);
        routes.push({
          kind: 'term',
          url,
          outPath: outPathFor(url),
          taxonomy: group.kind,
          term,
          page: slice.page,
          totalPages: slice.totalPages,
          slugs: slice.items.map((p) => p.frontmatter.slug),
        });
      }
    }
  }

  return routes;
}