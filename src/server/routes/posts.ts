import fs from 'node:fs/promises';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { FrontmatterError, createPostFrontmatterSchema } from '../../content/frontmatter';
import { scanContent } from '../../content/indexer';
import type { ContentIndex, PostEntry, PostState } from '../../content/model';
import { SlugError } from '../../content/slug';
import { ConflictError, ContentError, NotFoundError } from '../../content/store';
import { toPostSummary } from '../../content/model';
import type { ServerContext } from '../app';

const SORT_KEYS = ['date', 'updated', 'title', 'wordCount', 'readingTime'] as const;
type SortKey = (typeof SORT_KEYS)[number];

const STATUSES = ['all', 'draft', 'published', 'scheduled'] as const;

type RouteHandler = (c: Context) => Promise<Response>;

/** 内容层异常 -> HTTP 状态码的统一映射 */
export function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof NotFoundError) {
    return c.json({ error: 'not_found', message: error.message }, 404);
  }
  if (error instanceof ConflictError) {
    return c.json({ error: 'conflict', message: error.message, current: error.current }, 409);
  }
  if (error instanceof FrontmatterError) {
    return c.json({ error: 'invalid_frontmatter', message: error.message, issues: error.issues }, 400);
  }
  if (error instanceof z.ZodError) {
    return c.json(
      {
        error: 'invalid',
        message: '请求体校验失败',
        issues: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
      400,
    );
  }
  if (error instanceof ContentError || error instanceof SlugError) {
    return c.json({ error: 'invalid', message: error.message }, 400);
  }
  return c.json(
    { error: 'internal', message: error instanceof Error ? error.message : String(error) },
    500,
  );
}

function guarded(fn: RouteHandler): RouteHandler {
  return async (c) => {
    try {
      return await fn(c);
    } catch (error) {
      return errorResponse(c, error);
    }
  };
}

async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

/** 路由已匹配 :slug，此处收窄类型 */
function slugOf(c: Context): string {
  return c.req.param('slug') as string;
}

export async function serializeDetail(entry: PostEntry): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(entry.file, 'utf8');
  return {
    slug: entry.frontmatter.slug,
    kind: entry.kind,
    relDir: entry.relDir,
    state: entry.derived.state,
    url: entry.derived.url,
    hash: entry.derived.hash,
    wordCount: entry.derived.wordCount,
    readingTime: entry.derived.readingTime,
    assets: entry.assets,
    frontmatter: entry.frontmatter,
    body: entry.body,
    raw,
  };
}

function matchesQuery(entry: PostEntry, query: string): boolean {
  const haystack = [
    entry.frontmatter.title,
    entry.frontmatter.slug,
    entry.frontmatter.excerpt ?? '',
    ...(entry.frontmatter.tags ?? []),
    ...(entry.frontmatter.categories ?? []),
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
}

function sortValue(entry: PostEntry, key: SortKey): string | number {
  const fm = entry.frontmatter;
  switch (key) {
    case 'title':
      return fm.title.toLowerCase();
    case 'wordCount':
      return entry.derived.wordCount;
    case 'readingTime':
      return entry.derived.readingTime;
    case 'updated':
      return fm.updated ?? fm.date;
    default:
      return fm.date;
  }
}

function compare(a: PostEntry, b: PostEntry, key: SortKey, desc: boolean): number {
  const left = sortValue(a, key);
  const right = sortValue(b, key);
  let result: number;
  if (typeof left === 'number' && typeof right === 'number') result = left - right;
  else result = String(left).localeCompare(String(right));
  if (result === 0) result = a.frontmatter.slug.localeCompare(b.frontmatter.slug);
  return desc ? -result : result;
}

function collect(index: ContentIndex, query: Record<string, string | undefined>): PostEntry[] {
  let entries = [...index.posts, ...index.drafts];

  const status = (STATUSES as readonly string[]).includes(query.status ?? '')
    ? (query.status as (typeof STATUSES)[number])
    : 'all';
  if (status !== 'all') entries = entries.filter((entry) => entry.derived.state === status);
  if (query.tag) entries = entries.filter((entry) => (entry.frontmatter.tags ?? []).includes(query.tag!));
  if (query.category) {
    entries = entries.filter((entry) => (entry.frontmatter.categories ?? []).includes(query.category!));
  }
  if (query.q) {
    const needle = query.q.trim().toLowerCase();
    if (needle !== '') entries = entries.filter((entry) => matchesQuery(entry, needle));
  }

  const rawSort = (query.sort ?? '-date').trim();
  const desc = rawSort.startsWith('-');
  const key = (desc ? rawSort.slice(1) : rawSort) as SortKey;
  const valid = (SORT_KEYS as readonly string[]).includes(key) ? key : 'date';

  return entries.sort((a, b) => compare(a, b, valid, desc));
}

const createSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空'),
  slug: z.string().trim().optional(),
  date: z.string().trim().optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().trim().optional(),
  categories: z.array(z.string()).optional(),
  body: z.string().optional(),
  kind: z.enum(['post', 'draft']).optional(),
});

const saveSchema = z.object({
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  body: z.string(),
  hash: z.string().optional(),
});

export function createPostRoutes(ctx: ServerContext): Hono {
  const app = new Hono();
  const timezone = ctx.loaded.config.site.timezone;

  app.get(
    '/posts',
    guarded(async (c) => {
      const query = {
        status: c.req.query('status'),
        q: c.req.query('q'),
        tag: c.req.query('tag'),
        category: c.req.query('category'),
        sort: c.req.query('sort'),
      };
      const page = Math.max(1, Number(c.req.query('page') ?? '1') || 1);
      const pageSize = Math.min(200, Math.max(1, Number(c.req.query('pageSize') ?? '20') || 20));

      const index = await scanContent(ctx.loaded);
      const all = collect(index, query);
      const start = (page - 1) * pageSize;

      return c.json({
        total: all.length,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(all.length / pageSize)),
        items: all.slice(start, start + pageSize).map(toPostSummary),
      });
    }),
  );

  app.get(
    '/posts/:slug',
    guarded(async (c) => {
      const entry = await ctx.store.readPost(slugOf(c));
      return c.json(await serializeDetail(entry));
    }),
  );

  app.post(
    '/posts',
    guarded(async (c) => {
      const input = createSchema.parse(await readJson(c));
      const categories = [...(input.categories ?? []), ...(input.category ? [input.category] : [])];
      const entry = await ctx.store.createPost({
        kind: input.kind ?? 'post',
        title: input.title,
        slug: input.slug,
        date: input.date,
        tags: input.tags,
        categories: categories.length > 0 ? categories : undefined,
        body: input.body,
      });
      return c.json(await serializeDetail(entry), 201);
    }),
  );

  app.put(
    '/posts/:slug',
    guarded(async (c) => {
      const slug = slugOf(c);
      const input = saveSchema.parse(await readJson(c));
      const current = await ctx.store.readPost(slug);

      const incoming = input.frontmatter ?? {};
      const merged: Record<string, unknown> = {
        ...incoming,
        title: incoming.title ?? current.frontmatter.title,
        date: incoming.date ?? current.frontmatter.date,
        slug: current.frontmatter.slug,
      };
      const parsed = createPostFrontmatterSchema(timezone).safeParse(merged);
      if (!parsed.success) throw new FrontmatterError(
        parsed.error.issues.map((issue) => ({
          field: issue.path.length > 0 ? issue.path.join('.') : undefined,
          message: issue.message,
        })),
      );

      const entry = await ctx.store.savePost(slug, {
        frontmatter: parsed.data,
        body: input.body,
        hash: input.hash,
      });
      return c.json(await serializeDetail(entry));
    }),
  );

  app.patch(
    '/posts/:slug/state',
    guarded(async (c) => {
      const body = z.object({ state: z.enum(['draft', 'published', 'scheduled']) }).parse(await readJson(c));
      const entry = await ctx.store.setPostState(slugOf(c), body.state as PostState);
      return c.json(await serializeDetail(entry));
    }),
  );

  app.post(
    '/posts/:slug/rename',
    guarded(async (c) => {
      const body = z.object({ slug: z.string().trim().min(1) }).parse(await readJson(c));
      const entry = await ctx.store.renamePost(slugOf(c), body.slug);
      return c.json(await serializeDetail(entry));
    }),
  );

  app.delete(
    '/posts/:slug',
    guarded(async (c) => {
      const hard = c.req.query('hard') === '1' || c.req.query('hard') === 'true';
      const trashed = await ctx.store.deletePost(slugOf(c), hard);
      return c.json({ deleted: true, hard, trashed });
    }),
  );

  return app;
}