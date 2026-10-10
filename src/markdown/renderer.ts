import MarkdownIt from 'markdown-it';
import type { MarkdownIt as MarkdownItInstance } from 'markdown-it';
import anchor from 'markdown-it-anchor';
import footnote from 'markdown-it-footnote';
import taskLists from 'markdown-it-task-lists';
import type { LoadedConfig } from '../config/load';
import { sha1 } from '../util/hash';
import { LruCache } from '../util/lru';
import { escapeHtml, readingTime, uniqueStrings, wordCount } from '../util/text';
import { MORE_MARKER, buildExcerpt, stripMoreMarker } from './excerpt';
import { Highlighter, collectCodeLangs } from './highlighter';
import { imagesPlugin, type ImageRecord } from './images';
import { mathPlugin } from './math';
import { blockLinePlugin } from './text';
import { anchorSlug, buildTocTree, tocPlugin, type HeadingInfo, type TocItem } from './toc';

export interface MarkdownEnv {
  slug: string;
  /** 文章目录绝对路径 */
  assetDir: string;
  baseUrl: string;
  math: boolean;
  headings: HeadingInfo[];
  toc: TocItem[];
  images: ImageRecord[];
  usedLangs: string[];
  warnings: string[];
  srcsetFor?: (src: string) => string | undefined;
  [key: string]: unknown;
  [key: symbol]: unknown;
}

export interface RenderInput {
  body: string;
  slug: string;
  assetDir: string;
  /** true / false / 'auto'（默认：正文含 $ 才启用） */
  math?: boolean | 'auto';
  toc?: boolean;
  /** frontmatter.excerpt */
  excerpt?: string;
  excerptLength?: number;
  /** 构建期多尺寸变体查表（同步） */
  srcsetFor?: (src: string) => string | undefined;
}

export interface RenderedDocument {
  html: string;
  toc: TocItem[];
  headings: HeadingInfo[];
  excerpt: string;
  wordCount: number;
  readingTime: number;
  images: ImageRecord[];
  /** 本文实际用到并已加载的代码语言 */
  usedLangs: string[];
  warnings: string[];
  /** 命中内存缓存（未真正重渲染） */
  cached: boolean;
  elapsedMs: number;
}

export interface RenderOptions {
  /** 跳过内存缓存，强制真实渲染 */
  bypassCache?: boolean;
}

const DEFAULT_EXCERPT_LENGTH = 200;
const DOCUMENT_CACHE_LIMIT = 128;

interface ThemeShape {
  tocDepth?: unknown;
  codeTheme?: { light?: string; dark?: string };
}

function toNumber(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 渲染管线单一入口。
 * 高亮语言必须先 await engine.highlighter.init(langs) 预加载，之后 render 全同步。
 */
export class MarkdownEngine {
  readonly highlighter: Highlighter;
  private readonly cache = new LruCache<string, RenderedDocument>(DOCUMENT_CACHE_LIMIT);

  private readonly md: MarkdownItInstance;
  private readonly baseUrl: string;
  private readonly tocDepth: number;

  constructor(private readonly loaded: LoadedConfig) {
    const theme = loaded.config.theme.config as ThemeShape;
    this.baseUrl = loaded.config.site.baseUrl;
    this.tocDepth = toNumber(theme.tocDepth, 3);
    this.highlighter = new Highlighter(theme.codeTheme);

    this.md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: false,
      breaks: false,
    });

    this.md.use(anchor, { slugify: anchorSlug, tabIndex: false });
    this.md.use(blockLinePlugin);
    this.md.use(tocPlugin, { maxLevel: this.tocDepth });
    this.md.use(mathPlugin);
    this.md.use(imagesPlugin);
    this.md.use(footnote);
    // label:false —— 插件的 label 包裹会写入 Math.random() 生成的 id，导致 HTML 不可复现
    this.md.use(taskLists, { enabled: false, label: false });

    this.installFenceRule();
  }

  /** 预加载语言：正文语言 + 配置里的 extraLangs */
  async prepare(bodies: Iterable<string>): Promise<string[]> {
    const langs = new Set<string>(this.loaded.config.build.shiki.extraLangs);
    for (const body of bodies) {
      for (const lang of collectCodeLangs(body)) langs.add(lang);
    }
    await this.highlighter.init(langs);
    return [...langs];
  }

  render(input: RenderInput, options: RenderOptions = {}): RenderedDocument {
    const started = performance.now();
    const key = this.cacheKey(input);

    if (!options.bypassCache) {
      const hit = this.cache.get(key);
      if (hit) return { ...hit, cached: true, elapsedMs: round2(performance.now() - started) };
    }

    const env: MarkdownEnv = {
      slug: input.slug,
      assetDir: input.assetDir,
      baseUrl: this.baseUrl,
      math: input.math === 'auto' || input.math === undefined ? input.body.includes('$') : input.math === true,
      headings: [],
      toc: [],
      images: [],
      usedLangs: [],
      warnings: [],
      srcsetFor: input.srcsetFor,
    };

    const raw = this.md.render(input.body, env);
    const introHtml = raw.includes(MORE_MARKER) ? raw.split(MORE_MARKER)[0] : '';
    const html = stripMoreMarker(raw);

    const doc: RenderedDocument = {
      html,
      toc: input.toc === false ? [] : env.toc,
      headings: env.headings,
      excerpt: buildExcerpt({
        explicit: input.excerpt,
        introHtml,
        html,
        maxLength: input.excerptLength ?? DEFAULT_EXCERPT_LENGTH,
      }),
      wordCount: wordCount(input.body),
      readingTime: readingTime(input.body),
      images: env.images,
      usedLangs: uniqueStrings(env.usedLangs),
      warnings: uniqueStrings(env.warnings),
      cached: false,
      elapsedMs: round2(performance.now() - started),
    };

    this.cache.set(key, doc);
    return doc;
  }

  clearCache(): void {
    this.cache.clear();
  }

  /** 缓存 key 覆盖所有影响输出的入参 + 正文哈希 */
  private cacheKey(input: RenderInput): string {
    return [
      input.slug,
      input.assetDir,
      input.math === undefined ? 'auto' : String(input.math),
      input.toc === false ? '0' : '1',
      input.excerpt ?? '',
      String(input.excerptLength ?? DEFAULT_EXCERPT_LENGTH),
      input.srcsetFor ? '1' : '0',
      sha1(input.body),
    ].join('\u0000');
  }

  /** 表格、任务列表、脚注由插件负责；这里只接管代码围栏 */
  private installFenceRule(): void {
    this.md.renderer.rules.fence = (tokens, idx, _options, env) => {
      const token = tokens[idx];
      const info = (token.info ?? '').trim();
      const [fenceLang, ...rest] = info.split(/\s+/);
      const result = this.highlighter.highlight(token.content, fenceLang ?? '');
      if (env) (env as unknown as MarkdownEnv).usedLangs.push(result.lang);
      const line = token.map ? ` data-src-line="${token.map[0]}"` : '';
      const label = rest.join(' ') || result.lang;
      const labelClass = result.fallback ? 'code-block-lang is-fallback' : 'code-block-lang';

      const head =
        `<div class="code-block-head">` +
        `<span class="${labelClass}">${escapeHtml(label)}</span>` +
        `<button class="code-copy" type="button" aria-label="复制代码">复制</button>` +
        `</div>`;

      return (
        `<div class="code-block" data-lang="${escapeHtml(result.lang)}"${line}>` +
        head +
        result.html +
        `</div>\n`
      );
    };
  }
}

export { buildTocTree, MORE_MARKER };
export type { HeadingInfo, TocItem, ImageRecord };