import fs from 'node:fs/promises';
import path from 'node:path';
import type { LoadedConfig } from '../config/load';
import { formatLocal, nowLocal, parseLocal } from '../util/dates';
import { hash8, sha1 } from '../util/hash';
import { log } from '../util/logger';
import { encodeUrlPath, toPosix, toUrl } from '../util/paths';
import { readingTime, uniqueStrings, wordCount } from '../util/text';
import {
  FrontmatterError,
  parsePostSource,
  stringifyPostSource,
  type ParsedMarkdown,
} from './frontmatter';
import type { PostEntry, PostFrontmatter, PostKind, PostState } from './model';
import { loadScaffold, scaffoldPostDefaults } from './scaffold';
import { assertValidSlug, makeUniqueResourceName, makeUniqueSlug } from './slug';

export class ContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentError';
  }
}

export class NotFoundError extends ContentError {
  constructor(slug: string) {
    super(`找不到文章：${slug}`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ContentError {
  readonly current: { hash: string; raw: string; frontmatter: PostFrontmatter; body: string };

  constructor(slug: string, current: ConflictError['current']) {
    super(`文章「${slug}」已被外部修改`);
    this.name = 'ConflictError';
    this.current = current;
  }
}

export const POST_INDEX_FILE = 'index.md';

export function postUrl(slug: string, pattern: string, baseUrl: string): string {
  return toUrl(pattern.replace(/:slug/g, slug), baseUrl);
}

/** 把磁盘上的相对路径转成对外可用的 URL（逐段 encodeURI） */
export function assetUrl(relPath: string, baseUrl: string): string {
  const posix = toPosix(relPath);
  const prefix = posix.startsWith('posts/') || posix.startsWith('drafts/') ? '' : '/';
  return toUrl(`${prefix}${encodeUrlPath(posix)}`, baseUrl);
}

function normalizeRaw(raw: string): string {
  return raw.replace(/\r\n/g, '\n');
}

/** 列出目录内的所有文件（递归），返回相对该目录的 POSIX 路径 */
export async function listDirFiles(dir: string, exclude: string[] = []): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = toPosix(path.relative(dir, abs));
    if (exclude.includes(rel)) continue;
    out.push(rel);
  }
  return out.sort();
}

export function computeState(kind: PostKind, date: string, timezone: string): PostState {
  if (kind === 'draft') return 'draft';
  const parsed = parseLocal(date, timezone);
  if (parsed && parsed.getTime() > Date.now()) return 'scheduled';
  return 'published';
}

export function buildPostEntry(
  loaded: LoadedConfig,
  dir: string,
  kind: PostKind,
  raw: string,
  parsed: ParsedMarkdown<PostFrontmatter>,
  assets: string[],
): PostEntry {
  const normalized = normalizeRaw(raw);
  const { config } = loaded;
  const slug = path.basename(dir);
  return {
    kind,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    file: path.join(dir, POST_INDEX_FILE),
    dir,
    relDir: toPosix(path.relative(loaded.contentDir, dir)),
    assets,
    derived: {
      state: computeState(kind, parsed.frontmatter.date, config.site.timezone),
      url: postUrl(slug, config.permalinkPattern, config.site.baseUrl),
      wordCount: wordCount(parsed.body),
      readingTime: readingTime(parsed.body),
      hash: sha1(normalized),
    },
  };
}

export async function readPostEntry(
  loaded: LoadedConfig,
  dir: string,
  kind: PostKind,
): Promise<PostEntry> {
  const file = path.join(dir, POST_INDEX_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new NotFoundError(path.basename(dir));
  }
  const slug = path.basename(dir);
  const parsed = parsePostSource(raw, loaded.config.site.timezone, slug);
  const assets = await listDirFiles(dir, [POST_INDEX_FILE]);
  return buildPostEntry(loaded, dir, kind, raw, parsed, assets);
}

export interface CreatePostInput {
  kind: PostKind;
  title: string;
  slug?: string;
  date?: string;
  tags?: string[];
  categories?: string[];
  body?: string;
  excerpt?: string;
  cover?: string;
}

export interface SavePostInput {
  frontmatter: PostFrontmatter;
  body: string;
  /** 乐观锁：与磁盘当前 hash 不一致则抛 ConflictError */
  hash?: string;
}

export interface WriteMediaInput {
  filename: string;
  data: Buffer;
  scope: 'post' | 'global';
  slug?: string;
  timeZone: string;
}

export interface WrittenMedia {
  relPath: string;
  url: string;
  size: number;
}

export class ContentStore {
  constructor(readonly loaded: LoadedConfig) {}

  private get timezone(): string {
    return this.loaded.config.site.timezone;
  }

  private get baseUrl(): string {
    return this.loaded.config.site.baseUrl;
  }

  get postsDir(): string {
    return path.join(this.loaded.contentDir, 'posts');
  }

  get draftsDir(): string {
    return path.join(this.loaded.contentDir, 'drafts');
  }

  get mediaDir(): string {
    return path.join(this.loaded.contentDir, 'media');
  }

  get pagesDir(): string {
    return path.join(this.loaded.contentDir, 'pages');
  }

  get staticDir(): string {
    return path.join(this.loaded.contentDir, 'static');
  }

  dirForKind(kind: PostKind): string {
    return kind === 'draft' ? this.draftsDir : this.postsDir;
  }

  /** 在所有文章目录中定位 slug；同名时 posts/ 优先 */
  async locate(slug: string): Promise<{ dir: string; kind: PostKind } | null> {
    for (const kind of ['post', 'draft'] as PostKind[]) {
      const dir = path.join(this.dirForKind(kind), slug);
      try {
        const stat = await fs.stat(path.join(dir, POST_INDEX_FILE));
        if (stat.isFile()) return { dir, kind };
      } catch {
        /* 继续 */
      }
    }
    return null;
  }

  async readPost(slug: string): Promise<PostEntry> {
    const found = await this.locate(slug);
    if (!found) throw new NotFoundError(slug);
    return readPostEntry(this.loaded, found.dir, found.kind);
  }

  /** 当前占用的 slug 集合（小写比较，规避 Windows 大小写不敏感导致的碰撞） */
  private async takenSlugs(): Promise<Set<string>> {
    const taken = new Set<string>();
    for (const base of [this.postsDir, this.draftsDir]) {
      let entries;
      try {
        entries = await fs.readdir(base, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) taken.add(entry.name.toLowerCase());
      }
    }
    return taken;
  }

  async createPost(input: CreatePostInput): Promise<PostEntry> {
    const title = input.title.trim();
    if (title === '') throw new ContentError('标题不能为空');

    const taken = await this.takenSlugs();
    let slug: string;
    if (input.slug && input.slug.trim() !== '') {
      slug = input.slug.trim().toLowerCase();
      assertValidSlug(slug);
      if (taken.has(slug)) throw new ContentError(`slug「${slug}」已被占用`);
    } else {
      slug = makeUniqueSlug(title, taken);
    }

    const scaffold = await loadScaffold(this.loaded.scaffoldDir, input.kind);
    const now = nowLocal(this.timezone);

    const frontmatter: PostFrontmatter = {
      ...scaffoldPostDefaults(scaffold),
      title,
      slug,
      date: input.date ?? now,
      ...(input.tags && input.tags.length > 0 ? { tags: uniqueStrings(input.tags) } : {}),
      ...(input.categories && input.categories.length > 0
        ? { categories: uniqueStrings(input.categories) }
        : {}),
      ...(input.excerpt ? { excerpt: input.excerpt } : {}),
      ...(input.cover ? { cover: input.cover } : {}),
    };

    const dir = path.join(this.dirForKind(input.kind), slug);
    await fs.mkdir(dir, { recursive: true });
    const body = input.body ?? scaffold.body;
    await fs.writeFile(path.join(dir, POST_INDEX_FILE), stringifyPostSource(frontmatter, body), 'utf8');
    log.debug(`已创建文章 ${toPosix(path.relative(this.loaded.root, dir))}`);

    return readPostEntry(this.loaded, dir, input.kind);
  }

  async savePost(slug: string, input: SavePostInput): Promise<PostEntry> {
    const found = await this.locate(slug);
    if (!found) throw new NotFoundError(slug);

    const current = await readPostEntry(this.loaded, found.dir, found.kind);
    if (input.hash !== undefined && input.hash !== current.derived.hash) {
      throw new ConflictError(slug, {
        hash: current.derived.hash,
        raw: stringifyPostSource(current.frontmatter, current.body),
        frontmatter: current.frontmatter,
        body: current.body,
      });
    }

    const bodyChanged = input.body !== current.body;
    const frontmatter: PostFrontmatter = {
      ...input.frontmatter,
      slug: current.frontmatter.slug,
      date: input.frontmatter.date,
      ...(bodyChanged ? { updated: nowLocal(this.timezone) } : {}),
    };

    if (bodyChanged && input.frontmatter.updated === undefined && current.frontmatter.updated) {
      frontmatter.updated = nowLocal(this.timezone);
    }

    const next = stringifyPostSource(frontmatter, input.body);
    await fs.writeFile(current.file, next, 'utf8');
    return readPostEntry(this.loaded, found.dir, found.kind);
  }

  /** 切换草稿/已发布；发布时若日期在未来则改为当前时间，保证立即上线 */
  async setPostState(slug: string, state: PostState): Promise<PostEntry> {
    const found = await this.locate(slug);
    if (!found) throw new NotFoundError(slug);

    const targetKind: PostKind = state === 'draft' ? 'draft' : 'post';
    const entry = await readPostEntry(this.loaded, found.dir, found.kind);
    let frontmatter = entry.frontmatter;

    if (state === 'published') {
      const parsed = parseLocal(frontmatter.date, this.timezone);
      if (!parsed || parsed.getTime() > Date.now()) {
        frontmatter = { ...frontmatter, date: nowLocal(this.timezone) };
      }
    }

    await fs.writeFile(entry.file, stringifyPostSource(frontmatter, entry.body), 'utf8');

    if (targetKind !== found.kind) {
      const targetDir = path.join(this.dirForKind(targetKind), slug);
      if (targetKind === 'post') {
        const taken = await this.takenSlugs();
        if (taken.has(slug.toLowerCase()) && !found.dir.endsWith(slug)) {
          throw new ContentError(`posts/ 下已存在同名目录：${slug}`);
        }
      }
      await fs.mkdir(path.dirname(targetDir), { recursive: true });
      await this.moveDir(found.dir, targetDir);
      return readPostEntry(this.loaded, targetDir, targetKind);
    }

    return readPostEntry(this.loaded, found.dir, found.kind);
  }

  private async moveDir(from: string, to: string): Promise<void> {
    try {
      await fs.rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EXDEV' && code !== 'EPERM') throw error;
      await fs.cp(from, to, { recursive: true });
      await fs.rm(from, { recursive: true, force: true });
    }
  }

  async renamePost(slug: string, nextSlug: string): Promise<PostEntry> {
    const target = nextSlug.trim().toLowerCase();
    assertValidSlug(target);
    if (target === slug) return this.readPost(slug);

    const taken = await this.takenSlugs();
    if (taken.has(target)) throw new ContentError(`slug「${target}」已被占用`);

    const found = await this.locate(slug);
    if (!found) throw new NotFoundError(slug);

    const entry = await readPostEntry(this.loaded, found.dir, found.kind);
    const aliases = uniqueStrings([...(entry.frontmatter.aliases ?? []), slug]);
    const frontmatter: PostFrontmatter = { ...entry.frontmatter, slug: target, aliases };
    await fs.writeFile(entry.file, stringifyPostSource(frontmatter, entry.body), 'utf8');

    const targetDir = path.join(this.dirForKind(found.kind), target);
    await this.moveDir(found.dir, targetDir);
    return readPostEntry(this.loaded, targetDir, found.kind);
  }

  /** 软删除到 .cache/trash，便于误删恢复 */
  async deletePost(slug: string, hard = false): Promise<string> {
    const found = await this.locate(slug);
    if (!found) throw new NotFoundError(slug);

    if (hard) {
      await fs.rm(found.dir, { recursive: true, force: true });
      return '';
    }
    const trashDir = path.join(
      this.loaded.cacheDir,
      'trash',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug}`,
    );
    await fs.mkdir(path.dirname(trashDir), { recursive: true });
    await this.moveDir(found.dir, trashDir);
    return toPosix(path.relative(this.loaded.root, trashDir));
  }

  /** 写入媒体文件；post 作用域落到文章目录，global 落到 media/YYYY/MM */
  async writeMedia(input: WriteMediaInput): Promise<WrittenMedia> {
    let targetDir: string;
    let urlPrefix: string;

    if (input.scope === 'post') {
      if (!input.slug) throw new ContentError('post 作用域必须提供 slug');
      const found = await this.locate(input.slug);
      if (!found) throw new NotFoundError(input.slug);
      targetDir = found.dir;
      urlPrefix = postUrl(
        path.basename(found.dir),
        this.loaded.config.permalinkPattern,
        this.baseUrl,
      );
    } else {
      const yyyy = String(new Date().getUTCFullYear());
      const mm = String(new Date().getUTCMonth() + 1).padStart(2, '0');
      targetDir = path.join(this.mediaDir, yyyy, mm);
      urlPrefix = `/media/${yyyy}/${mm}/`;
    }

    const existing = new Set((await listDirFiles(targetDir)).map((f) => f.toLowerCase()));
    const name = makeUniqueResourceName(input.filename, existing, hash8(input.data));

    await fs.mkdir(targetDir, { recursive: true });
    const abs = path.join(targetDir, name);
    await fs.writeFile(abs, input.data);

    const relPath = toPosix(path.relative(this.loaded.contentDir, abs));
    return {
      relPath,
      url: `${urlPrefix}${encodeUrlPath(name)}`,
      size: input.data.byteLength,
    };
  }

  async listMedia(): Promise<{ relPath: string; url: string; size: number; mtimeMs: number }[]> {
    const files = await listDirFiles(this.mediaDir);
    const out: { relPath: string; url: string; size: number; mtimeMs: number }[] = [];
    for (const rel of files) {
      const abs = path.join(this.mediaDir, rel);
      try {
        const stat = await fs.stat(abs);
        out.push({
          relPath: toPosix(path.join('media', rel)),
          url: `/media/${encodeUrlPath(rel)}`,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        /* 忽略竞态删除 */
      }
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  /** 判断新增文章时是否需要把 updated 设为与 date 相同，供 UI 展示 */
  describeUpdated(frontmatter: PostFrontmatter): string {
    const updated = frontmatter.updated ?? frontmatter.date;
    return formatLocal(parseLocal(updated, this.timezone) ?? new Date(), this.timezone);
  }
}

export { FrontmatterError };