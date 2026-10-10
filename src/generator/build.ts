import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import type { LoadedConfig } from '../config/load';
import { DEFAULT_ACCENT } from '../config/defaults';
import { scanContent, buildTaxonomy } from '../content/indexer';
import type { ContentIndex, ContentIssue, PageEntry, PostEntry } from '../content/model';
import { MarkdownEngine } from '../markdown/renderer';
import type { RenderedDocument } from '../markdown/renderer';
import { resolveImageSrc } from '../markdown/images';
import { collectCodeLangs } from '../markdown/highlighter';
import { escapeHtml, taxonomySlug, uniqueStrings } from '../util/text';
import { formatLocal, nowLocal } from '../util/dates';
import { sha1 } from '../util/hash';
import { log } from '../util/logger';
import { encodeUrlPath, toUrl } from '../util/paths';
import { listDirFiles } from '../content/store';
import { collectContentAssets, collectThemeAssets } from './assets';
import { VariantBuilder, isBitmap } from './image-variants';
import { BuildCache, ENGINE_REVISION, type CachedDocument } from './cache';
import { renderRss } from './feeds';
import { buildPager, indexPageUrl } from './pagination';
import { outPathFor, planRoutes, planTaxonomyRoutes, termUrl, type RoutePlan } from './routes';
import { renderSearchIndex } from './search';
import { renderRobots, renderSitemap, type SitemapEntry } from './sitemap';
import {
  TemplateEngine,
  createHelpers,
  type ArchiveGroup,
  type BreadcrumbEntry,
  type OgImageView,
  type PageMeta,
  type PagerView,
  type PostView,
  type SiteView,
  type TaxonomyRef,
  type TemplateData,
  type TermView,
  type ThemeView,
} from './template';
import { DistWriter, type DistFile } from './writer';

export interface BuildProgress {
  phase: 'scan' | 'render' | 'pages' | 'assets' | 'write' | 'done';
  current: number;
  total: number;
  message: string;
}

export interface BuildOptions {
  /** 删除 dist 与全部缓存后重来 */
  clean?: boolean;
  /** 忽略磁盘缓存与内存缓存，强制真实渲染 */
  full?: boolean;
  /** 覆盖 config.build.drafts */
  drafts?: boolean;
  onProgress?: (progress: BuildProgress) => void;
}

export interface BuildStats {
  posts: number;
  pages: number;
  routes: number;
  assets: number;
  ms: number;
  cacheHits: number;
  cacheTotal: number;
  written: number;
  unchanged: number;
  removed: number;
}

/** 网页 <title> 分隔符：竖线在搜索结果的站点名切分上比间隔号更明确 */
const TITLE_SEP = ' | ';

export interface BuildResult {
  stats: BuildStats;
  changedUrls: string[];
  issues: ContentIssue[];
  warnings: string[];
  outDir: string;
}

const DEFAULT_EXCERPT_LENGTH = 200;

function themeString(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function themeNumber(source: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(source[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function themeBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === 'boolean' ? value : fallback;
}

/** 渲染入参哈希：覆盖所有影响 HTML 输出的因素，渲染逻辑改动靠 ENGINE_REVISION 失效 */
function documentKey(loaded: LoadedConfig, post: PostEntry, langs: string[]): string {
  const theme = loaded.config.theme;
  return sha1(
    [
      String(ENGINE_REVISION),
      post.frontmatter.slug,
      post.dir,
      post.body,
      post.frontmatter.math === undefined ? 'auto' : String(post.frontmatter.math),
      post.frontmatter.toc === false ? '0' : '1',
      post.frontmatter.excerpt ?? '',
      String(DEFAULT_EXCERPT_LENGTH),
      loaded.config.permalinkPattern,
      loaded.config.site.baseUrl,
      theme.config.codeTheme && typeof theme.config.codeTheme === 'object'
        ? JSON.stringify(theme.config.codeTheme)
        : '',
      langs.join(','),
    ].join('\u0000'),
  );
}

export class SiteBuilder {
  private readonly engine: MarkdownEngine;
  private readonly templates: TemplateEngine;
  private readonly helpers: ReturnType<typeof createHelpers>;
  private readonly site: SiteView;
  private readonly theme: ThemeView;
  private readonly timezone: string;
  private readonly baseUrl: string;
  private readonly postsPerPage: number;
  private readonly accentColor: string;
  private readonly colorMode: string;
  private readonly showReadingTime: boolean;
  private readonly showSearch: boolean;
  private readonly tocDepth: number;
  private readonly variants: VariantBuilder;
  /** 同步查表，供 markdown 渲染与封面使用 */
  private readonly srcset = (src: string): string | undefined => this.variants.srcsetFor(src);

  constructor(
    private readonly loaded: LoadedConfig,
    private options: BuildOptions = {},
  ) {
    const { config } = loaded;
    const themeConfig = config.theme.config;

    this.timezone = config.site.timezone;
    this.baseUrl = config.site.baseUrl;
    this.engine = new MarkdownEngine(loaded);
    this.templates = new TemplateEngine(loaded.themeDir, { cache: options.full !== true });
    this.helpers = createHelpers(loaded);
    this.variants = new VariantBuilder(path.join(loaded.cacheDir, 'img'));

    this.site = {
      title: config.site.title,
      subtitle: config.site.subtitle,
      description: config.site.description,
      keywords: config.site.keywords,
      author: config.site.author,
      email: config.site.email,
      lang: config.site.lang,
      url: config.site.url,
      baseUrl: this.baseUrl,
      logo: config.site.logo,
      favicon: config.site.favicon,
      footerHtml: config.site.footerHtml,
      verify: config.site.verify,
    };

    this.accentColor = themeString(themeConfig, 'accentColor', DEFAULT_ACCENT);
    this.colorMode = themeString(themeConfig, 'colorMode', 'auto');
    this.postsPerPage = themeNumber(themeConfig, 'postsPerPage', 10);
    this.showReadingTime = themeBoolean(themeConfig, 'showReadingTime', true);
    this.showSearch = themeBoolean(themeConfig, 'showSearch', true);
    this.tocDepth = themeNumber(themeConfig, 'tocDepth', 3);

    this.theme = {
      name: config.theme.name,
      config: themeConfig,
      accentColor: this.accentColor,
      colorMode: this.colorMode,
      showReadingTime: this.showReadingTime,
      showSearch: this.showSearch,
      tocDepth: this.tocDepth,
      assets: { css: '', js: '', version: '' },
    };
  }

  private report(phase: BuildProgress['phase'], current: number, total: number, message: string): void {
    this.options.onProgress?.({ phase, current, total, message });
  }

  async build(): Promise<BuildResult> {
    const started = Date.now();
    const { loaded } = this;
    const { config } = loaded;
    const outDir = loaded.outDir;
    const distHashFile = path.join(loaded.cacheDir, 'dist-hash.json');
    const buildCacheFile = path.join(loaded.cacheDir, 'build.json');

    if (this.options.clean) {
      this.report('scan', 0, 1, '清空 dist 与缓存');
      await fs.rm(outDir, { recursive: true, force: true });
      await fs.rm(distHashFile, { force: true });
      await fs.rm(buildCacheFile, { force: true });
    }

    this.report('scan', 0, 1, '扫描 content/');
    const index = await scanContent(loaded);
    const includeDrafts = this.options.drafts ?? config.build.drafts;
    const entries = includeDrafts ? [...index.posts, ...index.drafts] : [...index.posts];

    const routable = entries.filter(
      (entry) => entry.derived.state !== 'scheduled' || includeDrafts,
    );
    const listed = routable.filter((entry) => entry.frontmatter.hidden !== true);
    const hidden = routable.filter((entry) => entry.frontmatter.hidden === true);

    const cache = new BuildCache(buildCacheFile, config.build.cache && this.options.full !== true);
    await cache.load();

    const langsBySlug = new Map<string, string[]>();
    for (const entry of routable) {
      langsBySlug.set(entry.frontmatter.slug, collectCodeLangs(entry.body));
    }

    this.report('assets', 0, 1, '生成图片多尺寸变体');
    for (const entry of routable) {
      this.registerVariants(this.variants, entry.dir, entry.assets, (asset) => ({
        url: toUrl(`/posts/${entry.frontmatter.slug}/${encodeUrlPath(asset)}`, this.baseUrl),
        outPath: `posts/${entry.frontmatter.slug}/${asset}`,
      }));
    }
    const mediaDir = path.join(loaded.contentDir, 'media');
    this.registerVariants(this.variants, mediaDir, await listDirFiles(mediaDir), (rel) => ({
      url: `/media/${encodeUrlPath(rel)}`,
      outPath: `media/${rel}`,
    }));
    const variantResult = await this.variants.prepare();

    const docs = new Map<string, RenderedDocument>();
    const pending: PostEntry[] = [];

    for (const entry of routable) {
      const key = documentKey(loaded, entry, langsBySlug.get(entry.frontmatter.slug) ?? []);
      const cached = cache.get(entry.frontmatter.slug, key);
      if (cached) {
        docs.set(entry.frontmatter.slug, { ...cached, warnings: [], cached: true, elapsedMs: 0 });
        continue;
      }
      pending.push(entry);
    }

    if (pending.length > 0) {
      this.report('render', 0, pending.length, `渲染 ${pending.length} 篇正文`);
      await this.engine.prepare(pending.map((entry) => entry.body));
    }

    for (const [i, entry] of pending.entries()) {
      const doc = this.renderPost(entry);
      docs.set(entry.frontmatter.slug, doc);
      cache.set(entry.frontmatter.slug, documentKey(loaded, entry, langsBySlug.get(entry.frontmatter.slug) ?? []), this.toCached(doc));
      this.report('render', i + 1, pending.length, entry.frontmatter.slug);
    }
    cache.retain(routable.map((entry) => entry.frontmatter.slug));
    await cache.save();

    this.report('assets', 0, 1, '打包主题资源');
    const assets = await collectThemeAssets(loaded, { minify: config.build.minify });
    this.theme.assets = {
      css: assets.cssHref,
      js: assets.jsSrc,
      version: assets.buildHash,
    };

    this.report('pages', 0, 1, '规划路由');
    const routeWarnings: string[] = [];
    const taxonomy = buildTaxonomy(listed);
    const htmlRoutes: RoutePlan[] = [
      ...planRoutes({
        baseUrl: this.baseUrl,
        permalinkPattern: config.permalinkPattern,
        postsPerPage: this.postsPerPage,
        listed,
        hidden,
        pages: index.pages,
        warnings: routeWarnings,
      }),
      ...planTaxonomyRoutes(taxonomy, listed, this.baseUrl, this.postsPerPage),
    ];

    const entryBySlug = new Map(routable.map((entry) => [entry.frontmatter.slug, entry]));
    const views = new Map<string, PostView>();
    const toView = (entry: PostEntry): PostView => {
      const cached = views.get(entry.frontmatter.slug);
      if (cached) return cached;
      const view = this.toPostView(entry, docs.get(entry.frontmatter.slug)!);
      views.set(entry.frontmatter.slug, view);
      return view;
    };

    for (const entry of routable) toView(entry);
    const listViews = listed.map((entry) => toView(entry));
    this.linkNeighbours(listViews, listed);

    const writer = new DistWriter(outDir, distHashFile);
    const pageRoutes = htmlRoutes.filter((route) => route.kind !== 'post');
    this.report('pages', 0, htmlRoutes.length + 4, '渲染页面');

    let rendered = 0;
    for (const route of pageRoutes) {
      const html = this.renderRoute(route, { index, entryBySlug, toView });
      writer.add(route.outPath, html);
      rendered += 1;
      this.report('pages', rendered, htmlRoutes.length + 4, route.url);
    }
    for (const route of htmlRoutes) {
      if (route.kind !== 'post') continue;
      const entry = entryBySlug.get(route.slug)!;
      writer.add(route.outPath, this.renderPostRoute(route, toView(entry)));
      rendered += 1;
      this.report('pages', rendered, htmlRoutes.length + 4, route.url);
    }

    for (const file of assets.files) writer.add(file.outPath, file.content);
    for (const file of await collectContentAssets(loaded, routable)) {
      writer.add(file.outPath, file.content);
    }
    for (const file of variantResult.files) writer.add(file.outPath, file.content);

    writer.add('feed.xml', renderRss(this.templates, this.baseData(this.homeMeta()), listViews));

    const sitemapEntries = this.sitemapEntries(htmlRoutes, listViews, index.pages);
    writer.add(
      'sitemap.xml',
      renderSitemap(this.templates, this.baseData(this.homeMeta()), sitemapEntries),
    );
    writer.add('robots.txt', renderRobots(this.templates, this.baseData(this.homeMeta())));
    writer.add('search.json', renderSearchIndex(listViews));

    this.report('write', 0, writer.count, '写出 dist');
    const writeResult = await writer.commit(config.build.concurrency);

    const warnings = uniqueStrings([
      ...this.engine.highlighter.warnings,
      ...variantResult.warnings,
      ...[...docs.values()].flatMap((doc) => doc.warnings),
      ...routeWarnings,
    ]);

    const stats: BuildStats = {
      posts: listed.length + hidden.length,
      pages: index.pages.length,
      routes: htmlRoutes.length,
      assets: assets.files.length,
      ms: Date.now() - started,
      cacheHits: cache.hits,
      cacheTotal: cache.total,
      written: writeResult.written.length,
      unchanged: writeResult.unchanged,
      removed: writeResult.removed.length,
    };

    this.report('done', 1, 1, '完成');

    return {
      stats,
      changedUrls: writeResult.written.map(urlOfDistPath),
      issues: index.issues,
      warnings,
      outDir,
    };
  }

  /* ---------------------------------------------------------------- */
  /* 渲染                                                              */
  /* ---------------------------------------------------------------- */

  private renderPost(entry: PostEntry): RenderedDocument {
    return this.engine.render(
      {
        body: entry.body,
        slug: entry.frontmatter.slug,
        assetDir: entry.dir,
        math: entry.frontmatter.math ?? 'auto',
        toc: entry.frontmatter.toc !== false,
        excerpt: entry.frontmatter.excerpt,
        excerptLength: DEFAULT_EXCERPT_LENGTH,
        srcsetFor: this.srcset,
      },
      { bypassCache: this.options.full === true },
    );
  }

  private toCached(doc: RenderedDocument): CachedDocument {
    return {
      html: doc.html,
      toc: doc.toc,
      headings: doc.headings,
      excerpt: doc.excerpt,
      wordCount: doc.wordCount,
      readingTime: doc.readingTime,
      images: doc.images,
      usedLangs: doc.usedLangs,
    };
  }

  private toPostView(entry: PostEntry, doc: RenderedDocument): PostView {
    const fm = entry.frontmatter;
    const image = this.resolveCover(entry, doc);
    return {
      slug: fm.slug,
      title: fm.title,
      url: entry.derived.url,
      permalink: this.helpers.absolute(entry.derived.url),
      date: fm.date,
      updated: fm.updated ?? fm.date,
      tags: this.taxonomyRefs(fm.tags, 'tags'),
      categories: this.taxonomyRefs(fm.categories, 'categories'),
      cover: image.src,
      coverAlt: (fm.coverAlt ?? '').trim() || fm.title,
      coverWidth: image.width,
      coverHeight: image.height,
      coverSrcset: image.src === '' ? undefined : this.srcset(image.src),
      imageUrls: doc.images
        .filter((item) => item.local && item.exists && item.width && item.height)
        .map((item) => this.absoluteAsset(item.src)),
      excerpt: fm.excerpt ?? doc.excerpt,
      description: fm.description ?? fm.excerpt ?? doc.excerpt,
      lang: fm.lang ?? this.site.lang,
      pinned: fm.pinned === true,
      hidden: fm.hidden === true,
      wordCount: doc.wordCount,
      readingTime: doc.readingTime,
      state: entry.derived.state,
      html: doc.html,
      toc: fm.toc === false ? [] : doc.headings,
    };
  }

  private taxonomyRefs(names: string[] | undefined, kind: 'tags' | 'categories'): TaxonomyRef[] {
    return (names ?? []).map((name) => ({
      name,
      slug: taxonomySlug(name),
      url: termUrl(kind, taxonomySlug(name), 1, this.baseUrl),
    }));
  }

  private resolveCover(
    entry: PostEntry,
    doc: RenderedDocument,
  ): { src: string; width?: number; height?: number } {
    const raw = (entry.frontmatter.cover ?? '').trim();
    if (raw === '') return { src: this.loaded.config.site.defaultCover };
    if (raw === 'auto') {
      const first = doc.images.find((image) => image.local && image.exists);
      return first
        ? { src: first.src, width: first.width, height: first.height }
        : { src: this.loaded.config.site.defaultCover };
    }
    const record = resolveImageSrc(raw, {
      slug: entry.frontmatter.slug,
      assetDir: entry.dir,
      baseUrl: this.baseUrl,
    });
    return { src: record.src, width: record.width, height: record.height };
  }

  /** 登记目录下所有可测量位图作为变体源 */
  private registerVariants(
    builder: VariantBuilder,
    dir: string,
    files: readonly string[],
    map: (file: string) => { url: string; outPath: string },
  ): void {
    for (const file of files) {
      if (!isBitmap(file)) continue;
      let width: number | undefined;
      try {
        width = imageSize(readFileSync(path.join(dir, file))).width;
      } catch {
        width = undefined;
      }
      if (!width) continue;
      builder.register({ file: path.join(dir, file), width, ...map(file) });
    }
  }

  /* ---------------------------------------------------------------- */
  /* SEO：社交图 / 结构化数据 / 面包屑                                   */
  /* ---------------------------------------------------------------- */

  /** 站点内资源的完整地址；外链原样返回 */
  private absoluteAsset(target: string): string {
    const value = target.trim();
    if (value === '') return '';
    return /^https?:/i.test(value) ? value : this.helpers.absolute(value);
  }

  /** 测量 content/ 下的站点内图片；不存在或格式不可测时返回空 */
  private measureSiteImage(sitePath: string): { width?: number; height?: number } {
    const value = sitePath.trim();
    if (value === '' || /^https?:/i.test(value) || value.startsWith('//')) return {};
    try {
      const size = imageSize(readFileSync(path.join(this.loaded.contentDir, value.replace(/^\/+/, ''))));
      return { width: size.width, height: size.height };
    } catch {
      return {};
    }
  }

  /** 有封面用封面，否则回落站点默认社交图；两者都空则整组不输出 */
  private ogImageFor(cover: string, width: number | undefined, height: number | undefined, alt: string): OgImageView | null {
    const raw = cover.trim();
    if (raw !== '') {
      const measured = width && height ? { width, height } : this.measureSiteImage(raw);
      return { url: this.absoluteAsset(raw), ...measured, alt };
    }
    const fallback = this.loaded.config.site.defaultCover.trim();
    if (fallback === '') return null;
    return {
      url: this.absoluteAsset(fallback),
      ...this.measureSiteImage(fallback),
      alt: alt || this.site.title,
    };
  }

  private breadcrumbFor(view: PostView): BreadcrumbEntry[] {
    const items: BreadcrumbEntry[] = [{ name: '首页', url: this.helpers.url('/') }];
    const category = view.categories[0];
    if (category) items.push({ name: category.name, url: category.url });
    items.push({ name: view.title, url: view.url });
    return items;
  }

  private publisherJsonLd(): Record<string, unknown> {
    const logo = this.site.logo.trim();
    return {
      '@type': 'Organization',
      name: this.site.title,
      ...(logo === '' ? {} : { logo: { '@type': 'ImageObject', url: this.absoluteAsset(logo) } }),
    };
  }

  private serializeJsonLd(graph: unknown[]): string {
    if (graph.length === 0) return '';
    return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  }

  private websiteJsonLd(): unknown[] {
    return [
      {
        '@type': 'WebSite',
        name: this.site.title,
        url: this.helpers.absolute('/'),
        ...(this.site.description === '' ? {} : { description: this.site.description }),
        inLanguage: this.site.lang,
        publisher: this.publisherJsonLd(),
      },
    ];
  }

  private collectionJsonLd(
    name: string,
    url: string,
    description: string,
    items?: Array<{ name: string; url: string }>,
  ): unknown[] {
    const graph: unknown[] = [
      {
        '@type': 'CollectionPage',
        name,
        url: this.helpers.absolute(url),
        ...(description === '' ? {} : { description }),
        inLanguage: this.site.lang,
        isPartOf: { '@type': 'WebSite', name: this.site.title, url: this.helpers.absolute('/') },
      },
    ];
    if (items && items.length > 0) {
      graph.push({
        '@type': 'ItemList',
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          url: this.absoluteAsset(item.url),
        })),
      });
    }
    return graph;
  }

  private postJsonLd(view: PostView, breadcrumb: BreadcrumbEntry[]): unknown[] {
    const publisher = this.publisherJsonLd();
    const author = this.site.author === '' ? publisher : { '@type': 'Person', name: this.site.author };
    const graph: unknown[] = [
      {
        '@type': 'BlogPosting',
        headline: view.title,
        ...(view.description === '' ? {} : { description: view.description }),
        datePublished: this.helpers.dateTime(view.date),
        dateModified: this.helpers.dateTime(view.updated),
        ...(view.cover === '' ? {} : { image: [this.absoluteAsset(view.cover)] }),
        inLanguage: view.lang,
        mainEntityOfPage: { '@type': 'WebPage', '@id': view.permalink },
        author,
        publisher,
        ...(view.tags.length === 0 ? {} : { keywords: view.tags.map((tag) => tag.name).join(',') }),
        ...(view.categories.length === 0
          ? {}
          : { articleSection: view.categories.map((category) => category.name) }),
        wordCount: view.wordCount,
      },
    ];
    if (breadcrumb.length > 1) {
      graph.push({
        '@type': 'BreadcrumbList',
        itemListElement: breadcrumb.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: this.absoluteAsset(item.url),
        })),
      });
    }
    return graph;
  }

  /* ---------------------------------------------------------------- */
  /* 上下文与路由渲染                                                   */
  /* ---------------------------------------------------------------- */

  private pageMeta(
    url: string,
    type: string,
    title: string,
    description: string,
    isHome = false,
    robots = 'index,follow',
    lang = this.site.lang,
  ): PageMeta {
    return {
      url,
      type,
      title,
      description,
      canonical: this.helpers.absolute(url),
      lang,
      isHome,
      robots,
    };
  }

  private baseData(page: PageMeta): TemplateData {
    return {
      site: this.site,
      theme: this.theme,
      nav: this.loaded.config.navigation,
      social: this.loaded.config.social,
      page,
      posts: [],
      post: null,
      pagination: null,
      taxonomy: '',
      terms: [],
      archive: [],
      toc: [],
      ogImage: null,
      jsonLd: '',
      breadcrumb: [],
      year: Number(nowLocal(this.timezone).slice(0, 4)),
      buildTime: nowLocal(this.timezone),
      version: '',
      errors: [],
      helpers: this.helpers,
      body: '',
    };
  }

  private homeMeta(): PageMeta {
    return this.pageMeta(
      toUrl('/', this.baseUrl),
      'index',
      this.site.title,
      this.site.description,
      true,
    );
  }

  private pagerView(page: number, totalPages: number, urlForPage: (n: number) => string): PagerView {
    const pager = buildPager(page, totalPages, urlForPage);
    return {
      current: pager.current,
      total: pager.total,
      hasPrev: pager.hasPrev,
      hasNext: pager.hasNext,
      prevUrl: pager.prevUrl,
      nextUrl: pager.nextUrl,
      links: pager.links,
    };
  }

  private linkNeighbours(views: PostView[], sorted: PostEntry[]): void {
    const bySlug = new Map(views.map((view) => [view.slug, view]));
    sorted.forEach((entry, i) => {
      const view = bySlug.get(entry.frontmatter.slug);
      if (!view) return;
      const newer = sorted[i - 1];
      const older = sorted[i + 1];
      if (older) view.prev = { title: bySlug.get(older.frontmatter.slug)!.title, url: older.derived.url };
      if (newer) view.next = { title: bySlug.get(newer.frontmatter.slug)!.title, url: newer.derived.url };
    });
  }

  private archiveGroups(views: PostView[]): ArchiveGroup[] {
    const groups = new Map<string, PostView[]>();
    for (const view of views) {
      const year = view.date.slice(0, 4);
      const bucket = groups.get(year);
      if (bucket) bucket.push(view);
      else groups.set(year, [view]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, posts]) => ({ year, posts }));
  }

  private renderRoute(
    route: RoutePlan,
    ctx: {
      index: ContentIndex;
      entryBySlug: Map<string, PostEntry>;
      toView: (entry: PostEntry) => PostView;
    },
  ): string {
    switch (route.kind) {
      case 'index': {
        const posts = route.slugs.map((slug) => ctx.toView(ctx.entryBySlug.get(slug)!));
        const first = route.page <= 1;
        const title = first ? this.site.title : `${this.site.title}${TITLE_SEP}第 ${route.page} 页`;
        const description = first
          ? this.site.description
          : `第 ${route.page} 页（共 ${route.totalPages} 页），继续浏览 ${this.site.title} 的历史文章。`;
        const data = {
          ...this.baseData(
            this.pageMeta(
              route.url,
              'index',
              title,
              description,
              first,
              first ? 'index,follow' : 'noindex,follow',
            ),
          ),
          posts,
          ogImage: this.ogImageFor('', undefined, undefined, this.site.title),
          jsonLd: this.serializeJsonLd(
            first
              ? this.websiteJsonLd()
              : this.collectionJsonLd(title, route.url, description),
          ),
          pagination: this.pagerView(route.page, route.totalPages, (n) =>
            indexPageUrl(n, this.baseUrl),
          ),
        };
        return this.templates.renderPage('pages/index.ejs', data);
      }

      case 'archive': {
        const posts = route.slugs.map((slug) => ctx.toView(ctx.entryBySlug.get(slug)!));
        const archive = this.archiveGroups(posts);
        const description =
          archive.length === 0
            ? `按年份归档 ${this.site.title} 的全部文章。`
            : `按年份归档：${archive.map((group) => `${group.year} 年 ${group.posts.length} 篇`).join('，')}。`;
        const data = {
          ...this.baseData(
            this.pageMeta(route.url, 'archive', `归档${TITLE_SEP}${this.site.title}`, description),
          ),
          posts,
          archive,
          ogImage: this.ogImageFor('', undefined, undefined, this.site.title),
          jsonLd: this.serializeJsonLd(this.collectionJsonLd('归档', route.url, description)),
        };
        return this.templates.renderPage('pages/archive.ejs', data);
      }

      case 'taxonomy': {
        const label = route.taxonomy === 'tags' ? '标签' : '分类';
        const terms: TermView[] = route.terms.map((term) => ({
          name: term.name,
          slug: term.slug,
          url: termUrl(route.taxonomy, term.slug, 1, this.baseUrl),
          count: term.count,
        }));
        const covered = terms.reduce((sum, term) => sum + term.count, 0);
        const description = `${label}总览：共 ${terms.length} 个${label}，覆盖 ${covered} 篇文章。`;
        const data = {
          ...this.baseData(
            this.pageMeta(route.url, 'taxonomy', `${label}${TITLE_SEP}${this.site.title}`, description),
          ),
          taxonomy: route.taxonomy,
          terms,
          ogImage: this.ogImageFor('', undefined, undefined, this.site.title),
          jsonLd: this.serializeJsonLd(this.collectionJsonLd(label, route.url, description)),
        };
        return this.templates.renderPage('pages/taxonomy.ejs', data);
      }

      case 'term': {
        const posts = route.slugs.map((slug) => ctx.toView(ctx.entryBySlug.get(slug)!));
        const label = route.taxonomy === 'tags' ? '标签' : '分类';
        const name = route.term.name;
        const first = route.page <= 1;
        const title = first
          ? `${name}${TITLE_SEP}${label}${TITLE_SEP}${this.site.title}`
          : `${name}${TITLE_SEP}${label}${TITLE_SEP}第 ${route.page} 页${TITLE_SEP}${this.site.title}`;
        const preview = posts.slice(0, 4).map((view) => view.title).join('、');
        const full = `「${name}」${label}下共 ${route.term.count} 篇文章：${preview} 等。`;
        const description = full.length > 80 ? `${full.slice(0, 80)}…` : full;
        const data = {
          ...this.baseData(
            this.pageMeta(
              route.url,
              'term',
              title,
              description,
              first,
              first ? 'index,follow' : 'noindex,follow',
            ),
          ),
          taxonomy: route.taxonomy,
          terms: [
            {
              name: route.term.name,
              slug: route.term.slug,
              url: termUrl(route.taxonomy, route.term.slug, 1, this.baseUrl),
              count: route.term.count,
            },
          ],
          posts,
          ogImage: this.ogImageFor('', undefined, undefined, this.site.title),
          jsonLd: this.serializeJsonLd(
            this.collectionJsonLd(
              `${name} · ${label}`,
              route.url,
              description,
              posts.map((view) => ({ name: view.title, url: view.url })),
            ),
          ),
          pagination: this.pagerView(route.page, route.totalPages, (n) =>
            termUrl(route.taxonomy, route.term.slug, n, this.baseUrl),
          ),
        };
        return this.templates.renderPage('pages/index.ejs', data);
      }

      case 'page': {
        const page = ctx.index.pages.find((item) => item.pathname === route.pathname)!;
        const doc = this.engine.render(
          {
            body: page.body,
            slug: page.pathname,
            assetDir: page.dir,
            math: page.frontmatter.math ?? 'auto',
            toc: page.frontmatter.toc !== false,
            excerptLength: DEFAULT_EXCERPT_LENGTH,
            srcsetFor: this.srcset,
          },
          { bypassCache: this.options.full === true },
        );
        const toc = page.frontmatter.toc === false ? [] : doc.headings;
        const data = {
          ...this.baseData(
            this.pageMeta(
              route.url,
              'page',
              `${page.frontmatter.title}${TITLE_SEP}${this.site.title}`,
              page.frontmatter.description ?? this.site.description,
            ),
          ),
          post: {
            slug: page.pathname,
            title: page.frontmatter.title,
            url: page.url,
            permalink: this.helpers.absolute(page.url),
            date: page.frontmatter.date ?? this.buildDate(),
            updated: page.frontmatter.updated ?? page.frontmatter.date ?? this.buildDate(),
            tags: [],
            categories: [],
            cover: '',
            coverAlt: page.frontmatter.title,
            imageUrls: doc.images
              .filter((item) => item.local && item.exists && item.width && item.height)
              .map((item) => this.absoluteAsset(item.src)),
            excerpt: doc.excerpt,
            description: page.frontmatter.description ?? doc.excerpt,
            lang: this.site.lang,
            pinned: false,
            hidden: false,
            wordCount: page.derived.wordCount,
            readingTime: page.derived.readingTime,
            state: 'published',
            html: doc.html,
            toc,
          },
          toc,
          ogImage: this.ogImageFor('', undefined, undefined, this.site.title),
        };
        return this.templates.renderPage('pages/page.ejs', data);
      }

      case 'notfound': {
        const data = {
          ...this.baseData(
            this.pageMeta(route.url, 'notfound', `404${TITLE_SEP}${this.site.title}`, '', false, 'noindex,follow'),
          ),
        };
        return this.templates.renderPage('pages/404.ejs', data);
      }

      case 'alias': {
        const target = this.helpers.absolute(route.target);
        return [
          '<!DOCTYPE html>',
          `<html lang="${escapeHtml(this.site.lang)}">`,
          '<head>',
          '<meta charset="utf-8">',
          `<title>跳转中${TITLE_SEP}${escapeHtml(this.site.title)}</title>`,
          `<link rel="canonical" href="${escapeHtml(target)}">`,
          `<meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">`,
          '<meta name="robots" content="noindex,follow">',
          '</head>',
          '<body>',
          `<p>页面已迁移，正在跳转到 <a href="${escapeHtml(target)}">${escapeHtml(target)}</a>。</p>`,
          '</body>',
          '</html>',
        ].join('\n');
      }

      default:
        return '';
    }
  }

  private renderPostRoute(
    route: Extract<RoutePlan, { kind: 'post' }>,
    view: PostView,
  ): string {
    const breadcrumb = this.breadcrumbFor(view);
    const data = {
      ...this.baseData(
        this.pageMeta(
          route.url,
          'post',
          `${view.title}${TITLE_SEP}${this.site.title}`,
          view.description,
          false,
          'index,follow',
          view.lang,
        ),
      ),
      post: view,
      toc: view.toc,
      breadcrumb,
      ogImage: this.ogImageFor(view.cover, view.coverWidth, view.coverHeight, view.coverAlt),
      jsonLd: this.serializeJsonLd(this.postJsonLd(view, breadcrumb)),
    };
    return this.templates.renderPage('pages/post.ejs', data);
  }

  private buildDate(): string {
    return formatLocal(new Date(), this.timezone);
  }

  /* ---------------------------------------------------------------- */
  /* feed / sitemap                                                     */
  /* ---------------------------------------------------------------- */

  private sitemapEntries(
    routes: RoutePlan[],
    listViews: PostView[],
    pages: PageEntry[],
  ): SitemapEntry[] {
    const now = this.buildDate();
    const stamp = (value: string): string => this.helpers.dateTime(value) || this.helpers.dateTime(now);
    const latestOf = (values: string[]): string => {
      const filtered = values.filter((value) => value !== '').sort();
      return filtered.at(-1) ?? now;
    };
    const siteLastmod = stamp(
      latestOf([
        ...listViews.map((view) => view.updated),
        ...pages.map((page) => page.frontmatter.updated ?? page.frontmatter.date ?? ''),
      ]),
    );
    const contentLastmod = stamp(latestOf(listViews.map((view) => view.updated)));
    const bySlug = new Map(listViews.map((view) => [view.slug, view]));
    const termLastmod = (slugs: string[]): string =>
      stamp(latestOf(slugs.map((slug) => bySlug.get(slug)?.updated ?? '')));

    const entries: SitemapEntry[] = [];
    const push = (
      loc: string,
      lastmod: string,
      changefreq: string,
      priority: string,
      images: string[] = [],
    ): void => {
      entries.push({ loc, lastmod, changefreq, priority, images });
    };

    for (const route of routes) {
      if (route.kind === 'alias' || route.kind === 'notfound' || route.kind === 'post') continue;
      if (route.kind === 'index') {
        if (route.page > 1) continue;
        push(this.helpers.absolute(route.url), siteLastmod, 'daily', '1.0');
        continue;
      }
      if (route.kind === 'archive') {
        push(this.helpers.absolute(route.url), siteLastmod, 'weekly', '0.6');
        continue;
      }
      if (route.kind === 'taxonomy') {
        push(this.helpers.absolute(route.url), contentLastmod, 'weekly', '0.3');
        continue;
      }
      if (route.kind === 'term') {
        if (route.page > 1) continue;
        push(this.helpers.absolute(route.url), termLastmod(route.slugs), 'weekly', '0.6');
      }
    }

    for (const view of listViews) {
      push(view.permalink, stamp(view.updated), 'monthly', view.pinned ? '0.9' : '0.8', view.imageUrls);
    }

    for (const page of pages) {
      push(
        this.helpers.absolute(page.url),
        stamp(page.frontmatter.updated ?? page.frontmatter.date ?? now),
        'weekly',
        '0.7',
      );
    }

    return entries;
  }
}

export function urlOfDistPath(outPath: string): string {
  if (outPath === 'index.html') return '/';
  if (outPath.endsWith('/index.html')) return `/${outPath.slice(0, -'index.html'.length)}`;
  return `/${outPath}`;
}

export { outPathFor };

export async function buildSite(
  loaded: LoadedConfig,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const builder = new SiteBuilder(loaded, options);
  return builder.build();
}

export function parseBuildArgs(argv: string[]): BuildOptions {
  const options: BuildOptions = {
    onProgress: (progress) => log.debug(`[${progress.phase}] ${progress.message}`),
  };
  for (const arg of argv) {
    if (arg === '--clean') options.clean = true;
    else if (arg === '--full' || arg === '--no-cache') options.full = true;
    else if (arg === '--drafts') options.drafts = true;
  }
  return options;
}

export type { DistFile };