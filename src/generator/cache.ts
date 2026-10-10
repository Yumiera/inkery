import fs from 'node:fs/promises';
import path from 'node:path';
import type { ImageRecord } from '../markdown/images';
import type { HeadingInfo, TocItem } from '../markdown/toc';
import { log } from '../util/logger';

/** 渲染逻辑变更时手动 +1，令磁盘缓存整体失效 */
export const ENGINE_REVISION = 3;

const CACHE_VERSION = 1;

export interface CachedDocument {
  html: string;
  toc: TocItem[];
  headings: HeadingInfo[];
  excerpt: string;
  wordCount: number;
  readingTime: number;
  images: ImageRecord[];
  usedLangs: string[];
}

interface CacheEntry extends CachedDocument {
  /** 渲染入参哈希，与当前不一致即失效 */
  key: string;
}

interface CacheFile {
  version: number;
  engineRevision: number;
  entries: Record<string, CacheEntry>;
}

/**
 * 磁盘缓存：只有正文 HTML 进缓存，聚合页永远重渲染。
 * key 由 generator 计算（含 body 哈希、影响渲染的 frontmatter、主题名与语言集）。
 */
export class BuildCache {
  private entries = new Map<string, CacheEntry>();
  private hitsCount = 0;
  private missesCount = 0;

  constructor(
    private readonly file: string,
    private readonly enabled: boolean,
  ) {}

  get hits(): number {
    return this.hitsCount;
  }

  get misses(): number {
    return this.missesCount;
  }

  get total(): number {
    return this.hitsCount + this.missesCount;
  }

  async load(): Promise<void> {
    if (!this.enabled) return;
    let raw: string;
    try {
      raw = await fs.readFile(this.file, 'utf8');
    } catch {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.version !== CACHE_VERSION || parsed.engineRevision !== ENGINE_REVISION) return;
      for (const [slug, entry] of Object.entries(parsed.entries ?? {})) {
        if (entry && typeof entry.key === 'string' && typeof entry.html === 'string') {
          this.entries.set(slug, entry);
        }
      }
    } catch (error) {
      log.warn(`构建缓存损坏，已忽略：${error instanceof Error ? error.message : String(error)}`);
      this.entries.clear();
    }
  }

  get(slug: string, key: string): CachedDocument | null {
    if (!this.enabled) {
      this.missesCount += 1;
      return null;
    }
    const entry = this.entries.get(slug);
    if (!entry || entry.key !== key) {
      this.missesCount += 1;
      return null;
    }
    this.hitsCount += 1;
    const { key: _key, ...doc } = entry;
    return doc;
  }

  set(slug: string, key: string, doc: CachedDocument): void {
    this.entries.set(slug, { key, ...doc });
  }

  /** 丢弃已不存在的 slug */
  retain(slugs: Iterable<string>): void {
    const keep = new Set(slugs);
    for (const slug of [...this.entries.keys()]) {
      if (!keep.has(slug)) this.entries.delete(slug);
    }
  }

  async save(): Promise<void> {
    if (!this.enabled) return;
    const payload: CacheFile = {
      version: CACHE_VERSION,
      engineRevision: ENGINE_REVISION,
      entries: Object.fromEntries([...this.entries.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(payload), 'utf8');
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.hitsCount = 0;
    this.missesCount = 0;
    try {
      await fs.rm(this.file, { force: true });
    } catch {
      /* 忽略 */
    }
  }
}