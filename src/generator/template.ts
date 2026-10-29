import fs from 'node:fs';
import path from 'node:path';
import ejs from 'ejs';
import type { NavItem, SocialItem } from '../config/schema';
import type { LoadedConfig } from '../config/load';
import type { ContentIssue } from '../content/model';
import type { HeadingInfo } from '../markdown/toc';
import { parseLocal } from '../util/dates';
import { absoluteUrl as makeAbsoluteUrl, toUrl } from '../util/paths';
import { taxonomySlug } from '../util/text';

export interface SiteView {
  title: string;
  subtitle: string;
  description: string;
  keywords: string[];
  author: string;
  email: string;
  lang: string;
  url: string;
  baseUrl: string;
  logo: string;
  favicon: string;
  footerHtml: string;
  verify: {
    google: string;
    bing: string;
    baidu: string;
    yandex: string;
  };
  indexNow: {
    enabled: boolean;
    key: string;
  };
}

export interface ThemeAssetsView {
  css: string;
  js: string;
  version: string;
}

export interface ThemeView {
  name: string;
  config: Record<string, unknown>;
  accentColor: string;
  colorMode: string;
  showReadingTime: boolean;
  showSearch: boolean;
  tocDepth: number;
  assets: ThemeAssetsView;
}

export interface TaxonomyRef {
  name: string;
  slug: string;
  url: string;
}

export interface OgImageView {
  url: string;
  width?: number;
  height?: number;
  alt: string;
}

export interface BreadcrumbEntry {
  name: string;
  url: string;
}

export interface PostView {
  slug: string;
  title: string;
  url: string;
  permalink: string;
  date: string;
  updated: string;
  tags: TaxonomyRef[];
  categories: TaxonomyRef[];
  cover: string;
  coverAlt: string;
  coverWidth?: number;
  coverHeight?: number;
  /** 有多档变体时才输出 */
  coverSrcset?: string;
  /** 正文内本地且已测量尺寸的图片绝对 URL，供 sitemap image:image 使用 */
  imageUrls: string[];
  excerpt: string;
  description: string;
  lang: string;
  pinned: boolean;
  hidden: boolean;
  wordCount: number;
  readingTime: number;
  state: string;
  html: string;
  /** 扁平化的目录标题；toc 关闭时为空数组 */
  toc: HeadingInfo[];
  prev?: { title: string; url: string };
  next?: { title: string; url: string };
}

export interface PageMeta {
  url: string;
  type: string;
  title: string;
  description: string;
  canonical: string;
  lang: string;
  isHome: boolean;
  robots: string;
}

export interface ArchiveGroup {
  year: string;
  posts: PostView[];
}

export interface TermView {
  name: string;
  slug: string;
  url: string;
  count: number;
}

export interface PagerView {
  current: number;
  total: number;
  hasPrev: boolean;
  hasNext: boolean;
  prevUrl: string;
  nextUrl: string;
  links: Array<{ page: number; url: string; current: boolean }>;
}

export interface Helpers {
  url(p: string): string;
  absolute(p: string): string;
  formatDate(input?: string, style?: 'short' | 'long'): string;
  dateTime(input?: string): string;
  rfc822(input?: string): string;
  year(input?: string): string;
  tagUrl(name: string): string;
  categoryUrl(name: string): string;
  readingLabel(minutes: number): string;
  cdata(text: string): string;
}

export interface TemplateData {
  site: SiteView;
  theme: ThemeView;
  nav: NavItem[];
  social: SocialItem[];
  page: PageMeta;
  posts: PostView[];
  post: PostView | null;
  pagination: PagerView | null;
  taxonomy: string;
  terms: TermView[];
  /** 归档页的按年分组 */
  archive: ArchiveGroup[];
  /** 扁平化的目录标题，level 决定缩进 */
  toc: HeadingInfo[];
  /** 社交分享图；无图时为 null，模板整组不输出 */
  ogImage: OgImageView | null;
  /** 已字符串化的 JSON-LD（`@graph`）；空串表示该页不输出 */
  jsonLd: string;
  /** 面包屑；长度 ≤1 时模板不渲染 */
  breadcrumb: BreadcrumbEntry[];
  year: number;
  buildTime: string;
  version: string;
  errors: ContentIssue[];
  helpers: Helpers;
  body: string;
  [key: string]: unknown;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function wallClockMs(local: string): number {
  return Date.parse(`${local.replace(' ', 'T')}Z`);
}

/**
 * 模板层的时间格式化。frontmatter 里是站点时区的墙上时间，
 * 输出 ISO / RFC822 时用回读偏移量补上时区，避免服务器时区干扰。
 */
export function createHelpers(loaded: LoadedConfig): Helpers {
  const timezone = loaded.config.site.timezone;
  const baseUrl = loaded.config.site.baseUrl;
  const siteUrl = loaded.config.site.url;

  const offsetLabel = (local: string, style: 'iso' | 'rfc'): string => {
    const date = parseLocal(local, timezone);
    if (!date) return style === 'iso' ? '+00:00' : '+0000';
    const minutes = Math.round((wallClockMs(local) - date.getTime()) / 60000);
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return style === 'iso' ? `${sign}${hh}:${mm}` : `${sign}${hh}${mm}`;
  };

  return {
    url: (p) => toUrl(p, baseUrl),
    absolute: (p) => makeAbsoluteUrl(siteUrl, p, baseUrl),

    formatDate(input = '', style = 'short') {
      const date = parseLocal(input, timezone);
      if (!date) return input;
      const [y, m, d] = input.slice(0, 10).split('-');
      return style === 'long' ? `${y} 年 ${Number(m)} 月 ${Number(d)} 日` : `${y}-${m}-${d}`;
    },

    dateTime(input = '') {
      const local = input.trim();
      if (local === '' || !parseLocal(local, timezone)) return '';
      return `${local.replace(' ', 'T')}${offsetLabel(local, 'iso')}`;
    },

    rfc822(input = '') {
      const date = parseLocal(input, timezone);
      if (!date) return '';
      const [ymd, time] = input.split(' ');
      const [y, m, d] = ymd.split('-');
      return `${WEEKDAYS[date.getUTCDay()]}, ${d} ${MONTHS[Number(m) - 1]} ${y} ${time} ${offsetLabel(input, 'rfc')}`;
    },

    year(input = '') {
      return input.slice(0, 4);
    },

    tagUrl: (name) => toUrl(`/tags/${taxonomySlug(name)}/`, baseUrl),
    categoryUrl: (name) => toUrl(`/categories/${taxonomySlug(name)}/`, baseUrl),
    readingLabel: (minutes) => `约 ${minutes} 分钟`,
    cdata: (text) => String(text ?? '').replace(/]]>/g, ']]]]><![CDATA[>'),
  };
}

export interface TemplateEngineOptions {
  /** 编译结果按 文件+mtime 缓存；主题模板频繁改动时关闭 */
  cache?: boolean;
}

/**
 * EJS 薄封装：root 固定为主题目录，partial 用 `/partials/x` 绝对引用。
 * 编译结果按「文件 + mtime」自管缓存，不使用 ejs 的全局 filename 缓存
 * （后者在长驻进程里会让模板改动永远不生效）。
 */
export class TemplateEngine {
  private readonly root: string;
  private readonly compiled = new Map<string, { mtimeMs: number; fn: ejs.TemplateFunction }>();

  constructor(
    private readonly themeDir: string,
    private readonly options: TemplateEngineOptions = {},
  ) {
    this.root = themeDir;
  }

  exists(relPath: string): boolean {
    return fs.existsSync(path.join(this.themeDir, relPath));
  }

  render(relPath: string, data: Record<string, unknown>): string {
    const file = path.join(this.themeDir, relPath);
    const source = fs.readFileSync(file, 'utf8');

    if (this.options.cache !== true) {
      return ejs.render(source, data, { filename: file, root: this.root, cache: false });
    }

    const mtimeMs = fs.statSync(file).mtimeMs;
    const hit = this.compiled.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.fn(data);

    const fn = ejs.compile(source, { filename: file, root: this.root, cache: false });
    this.compiled.set(file, { mtimeMs, fn });
    return fn(data);
  }

  /** 页面模板渲染出 body，再套统一 layout */
  renderPage(relPath: string, data: TemplateData): string {
    const body = this.render(relPath, data as unknown as Record<string, unknown>);
    return this.render('layout.ejs', { ...data, body });
  }
}