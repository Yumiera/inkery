import fs from 'node:fs/promises';
import path from 'node:path';
import type { LoadedConfig } from '../config/load';
import { parseLocal } from '../util/dates';
import { sha1 } from '../util/hash';
import { encodeUrlPath, toPosix, toUrl } from '../util/paths';
import { readingTime, taxonomySlug, wordCount } from '../util/text';
import { FrontmatterError, parsePageSource } from './frontmatter';
import { ContentError, NotFoundError, listDirFiles, readPostEntry } from './store';
import type {
  ContentIndex,
  ContentIssue,
  MediaFile,
  PageEntry,
  PostEntry,
  PostKind,
  TaxonomyIndex,
  TaxonomyTerm,
} from './model';
import { POST_INDEX_FILE } from './store';

function relToRoot(loaded: LoadedConfig, abs: string): string {
  return toPosix(path.relative(loaded.root, abs));
}

function issueFor(loaded: LoadedConfig, file: string, message: string, field?: string): ContentIssue {
  return { file, rel: relToRoot(loaded, file), field, message };
}

async function readDirSafe(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function scanPostKind(
  loaded: LoadedConfig,
  kind: PostKind,
  issues: ContentIssue[],
): Promise<PostEntry[]> {
  const base = path.join(loaded.contentDir, kind === 'draft' ? 'drafts' : 'posts');
  const out: PostEntry[] = [];

  for (const entry of await readDirSafe(base)) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(base, entry.name);
    const file = path.join(dir, POST_INDEX_FILE);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) continue;
    } catch {
      issues.push(issueFor(loaded, dir, `目录 ${entry.name} 下缺少 ${POST_INDEX_FILE}，已跳过`));
      continue;
    }

    try {
      out.push(await readPostEntry(loaded, dir, kind));
    } catch (error) {
      if (error instanceof FrontmatterError) {
        for (const item of error.issues) {
          issues.push(issueFor(loaded, file, item.message, item.field));
        }
      } else if (error instanceof Error) {
        issues.push(issueFor(loaded, file, error.message));
      }
    }
  }

  return out;
}

/** 扫描 content/pages：支持 pages/a.md 与 pages/guide/index.md 两种布局 */
async function scanPages(loaded: LoadedConfig, issues: ContentIssue[]): Promise<PageEntry[]> {
  const base = path.join(loaded.contentDir, 'pages');
  const out: PageEntry[] = [];

  for (const rel of await listDirFiles(base)) {
    if (!rel.toLowerCase().endsWith('.md')) continue;

    const abs = path.join(base, rel);
    const stem = rel.slice(0, -3);
    const pathname = stem.replace(/\/index$/, '').replace(/^index$/, '');
    if (pathname === '') {
      issues.push(issueFor(loaded, abs, 'pages/index.md 会被首页占用，请改名'));
      continue;
    }

    try {
      const raw = (await fs.readFile(abs, 'utf8')).replace(/\r\n/g, '\n');
      const parsed = parsePageSource(raw, loaded.config.site.timezone, pathname);
      const dir = path.dirname(abs);
      const assets = rel.endsWith('/index.md') || rel === 'index.md'
        ? await listDirFiles(dir, [POST_INDEX_FILE])
        : [];
      out.push({
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        file: abs,
        dir,
        relPath: toPosix(path.join('pages', rel)),
        pathname,
        url: toUrl(`/${encodeUrlPath(pathname)}/`, loaded.config.site.baseUrl),
        assets,
        derived: {
          hash: sha1(raw),
          wordCount: wordCount(parsed.body),
          readingTime: readingTime(parsed.body),
        },
      });
    } catch (error) {
      if (error instanceof FrontmatterError) {
        for (const item of error.issues) {
          issues.push(issueFor(loaded, abs, item.message, item.field));
        }
      } else if (error instanceof Error) {
        issues.push(issueFor(loaded, abs, error.message));
      }
    }
  }

  return out.sort((a, b) => a.pathname.localeCompare(b.pathname));
}

async function scanMedia(loaded: LoadedConfig): Promise<MediaFile[]> {
  const base = path.join(loaded.contentDir, 'media');
  const files = await listDirFiles(base);
  const out: MediaFile[] = [];
  for (const rel of files) {
    const abs = path.join(base, rel);
    try {
      const stat = await fs.stat(abs);
      out.push({
        relPath: toPosix(path.join('media', rel)),
        url: `/media/${encodeUrlPath(rel)}`,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      /* 忽略 */
    }
  }
  return out;
}

function detectSlugConflicts(entries: PostEntry[], issues: ContentIssue[]): void {
  const seen = new Map<string, PostEntry>();
  for (const entry of entries) {
    const key = entry.frontmatter.slug.toLowerCase();
    const previous = seen.get(key);
    if (previous) {
      issues.push({
        file: entry.file,
        rel: entry.relDir,
        field: 'slug',
        message: `slug「${entry.frontmatter.slug}」与 ${previous.relDir} 重复（Windows 下大小写不敏感，会导致互相覆盖）`,
      });
    } else {
      seen.set(key, entry);
    }
  }
}

function detectAssetConflicts(entries: PostEntry[], issues: ContentIssue[]): void {
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const asset of entry.assets) {
      const key = asset.toLowerCase();
      if (seen.has(key)) {
        issues.push({
          file: path.join(entry.dir, asset),
          rel: `${entry.relDir}/${asset}`,
          message: '同目录下存在仅大小写不同的资源名，Windows 下会互相覆盖',
        });
      } else {
        seen.add(key);
      }
    }
  }
}

export async function scanContent(loaded: LoadedConfig): Promise<ContentIndex> {
  const started = Date.now();
  const issues: ContentIssue[] = [];

  const [posts, drafts, pages] = await Promise.all([
    scanPostKind(loaded, 'post', issues),
    scanPostKind(loaded, 'draft', issues),
    scanPages(loaded, issues),
  ]);

  const [media, staticFiles] = await Promise.all([
    scanMedia(loaded),
    listDirFiles(path.join(loaded.contentDir, 'static')),
  ]);

  detectSlugConflicts([...posts, ...drafts], issues);
  detectAssetConflicts([...posts, ...drafts], issues);

  const timezone = loaded.config.site.timezone;
  const byDateDesc = (a: PostEntry, b: PostEntry) => {
    const da = parseLocal(a.frontmatter.date, timezone)?.getTime() ?? 0;
    const db = parseLocal(b.frontmatter.date, timezone)?.getTime() ?? 0;
    if (db !== da) return db - da;
    return a.frontmatter.slug.localeCompare(b.frontmatter.slug);
  };

  return {
    posts: posts.sort(byDateDesc),
    drafts: drafts.sort(byDateDesc),
    pages,
    media,
    staticFiles,
    issues,
    elapsedMs: Date.now() - started,
  };
}

/** 标签/分类聚合；hidden 文章不计入 */
export function buildTaxonomy(entries: PostEntry[]): TaxonomyIndex {
  const tags = new Map<string, TaxonomyTerm>();
  const categories = new Map<string, TaxonomyTerm>();

  const collect = (store: Map<string, TaxonomyTerm>, name: string) => {
    const key = name.trim();
    if (key === '') return;
    const existing = store.get(key);
    if (existing) existing.count += 1;
    else store.set(key, { name: key, slug: taxonomySlug(key), count: 1 });
  };

  for (const entry of entries) {
    if (entry.frontmatter.hidden === true) continue;
    for (const tag of entry.frontmatter.tags ?? []) collect(tags, tag);
    for (const category of entry.frontmatter.categories ?? []) collect(categories, category);
  }

  const sortTerms = (store: Map<string, TaxonomyTerm>) =>
    [...store.values()].sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)));

  return { tags: sortTerms(tags), categories: sortTerms(categories) };
}

export { ContentError, NotFoundError };