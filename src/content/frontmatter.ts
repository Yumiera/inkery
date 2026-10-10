import matter from 'gray-matter';
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml';
import { z } from 'zod';
import { parseLocal } from '../util/dates';
import { SLUG_RE } from '../util/text';
import type { PageFrontmatter, PostFrontmatter } from './model';

/**
 * 用 JSON_SCHEMA 解析 YAML：YAML 默认 schema 会把 `date: 2025-10-20 14:47:42`
 * 解析成 Date 对象再按 UTC 换算，造成时区漂移。JSON_SCHEMA 不含 timestamp 类型，
 * 于是所有日期都以字符串原样保留。
 */
const YAML_ENGINE = {
  parse(source: string): object {
    const parsed = loadYaml(source, { schema: JSON_SCHEMA });
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as object;
    }
    return {};
  },
  stringify(): string {
    return '';
  },
};

const MATTER_OPTIONS = { engines: { yaml: YAML_ENGINE } };

export interface FrontmatterIssue {
  field?: string;
  message: string;
}

export class FrontmatterError extends Error {
  readonly issues: FrontmatterIssue[];

  constructor(issues: FrontmatterIssue[]) {
    super(issues.map((i) => (i.field ? `${i.field} — ${i.message}` : i.message)).join('; '));
    this.name = 'FrontmatterError';
    this.issues = issues;
  }
}

export interface ParsedMarkdown<T> {
  frontmatter: T;
  body: string;
}

/* ------------------------------------------------------------------ */
/* 字段定义                                                            */
/* ------------------------------------------------------------------ */

function dateField(timezone: string) {
  return z.preprocess(
    (value) => {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? value : value.toISOString();
      if (typeof value === 'number') return String(value);
      return typeof value === 'string' ? value.trim() : value;
    },
    z
      .string()
      .refine((v) => parseLocal(v, timezone) !== null, {
        message: '必须是 YYYY-MM-DD HH:mm:ss 且为站点时区下的合法时间',
      }),
  );
}

/** 允许 `tags: a, b` 与 `tags: [a, b]` 两种写法 */
const stringList = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : String(v)).trim())
      .filter((s) => s !== '');
  }
  return [String(value).trim()];
}, z.array(z.string()));

const mathField = z.union([z.boolean(), z.literal('auto')]);

const optionalString = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim() : v === null ? undefined : v),
  z.string(),
);

export function createPostFrontmatterSchema(timezone: string) {
  return z
    .object({
      title: z.string().trim().min(1, '标题不能为空'),
      slug: z.string().trim().regex(SLUG_RE, 'slug 只能由小写字母、数字和连字符组成'),
      date: dateField(timezone),
      updated: dateField(timezone).optional(),
      tags: stringList.optional(),
      categories: stringList.optional(),
      cover: optionalString.optional(),
      coverAlt: optionalString.optional(),
      excerpt: optionalString.optional(),
      description: optionalString.optional(),
      keywords: stringList.optional(),
      author: optionalString.optional(),
      lang: optionalString.optional(),
      pinned: z.boolean().optional(),
      toc: z.boolean().optional(),
      math: mathField.optional(),
      comments: z.boolean().optional(),
      hidden: z.boolean().optional(),
      aliases: stringList.optional(),
      series: optionalString.optional(),
    })
    .strict();
}

export function createPageFrontmatterSchema(timezone: string) {
  return z
    .object({
      title: optionalString.optional(),
      date: dateField(timezone).optional(),
      updated: dateField(timezone).optional(),
      description: optionalString.optional(),
      toc: z.boolean().optional(),
      math: mathField.optional(),
    })
    .strict();
}

/* ------------------------------------------------------------------ */
/* 解析                                                                */
/* ------------------------------------------------------------------ */

function toIssues(error: z.ZodError): FrontmatterIssue[] {
  return error.issues.map((issue) => {
    if (issue.code === 'unrecognized_keys') {
      const keys = (issue as unknown as { keys: string[] }).keys;
      return { field: keys.join(', '), message: '未知字段（请检查拼写，或从 frontmatter 中移除）' };
    }
    return {
      field: issue.path.length > 0 ? issue.path.join('.') : undefined,
      message: issue.message,
    };
  });
}

function normalizeBody(content: string): string {
  return content.replace(/^\s*\n+/, '');
}

export function parsePostSource(
  raw: string,
  timezone: string,
  slugHint?: string,
): ParsedMarkdown<PostFrontmatter> {
  const parsed = matter(raw, MATTER_OPTIONS);
  const data = parsed.data as Record<string, unknown>;

  if (slugHint !== undefined && (data.slug === undefined || data.slug === null || data.slug === '')) {
    data.slug = slugHint;
  }

  const result = createPostFrontmatterSchema(timezone).safeParse(data);
  if (!result.success) throw new FrontmatterError(toIssues(result.error));

  return { frontmatter: result.data as PostFrontmatter, body: normalizeBody(parsed.content) };
}

export function parsePageSource(
  raw: string,
  timezone: string,
  nameHint: string,
): ParsedMarkdown<PageFrontmatter> {
  const parsed = matter(raw, MATTER_OPTIONS);
  const data = parsed.data as Record<string, unknown>;

  const result = createPageFrontmatterSchema(timezone).safeParse(data);
  if (!result.success) throw new FrontmatterError(toIssues(result.error));

  const frontmatter: PageFrontmatter = { ...(result.data as PageFrontmatter) };
  if (!frontmatter.title) {
    frontmatter.title = nameHint
      .split('/')
      .pop()!
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return { frontmatter, body: normalizeBody(parsed.content) };
}

/** 提取原始 frontmatter 文本，供后台「原始 YAML 编辑」使用 */
export function rawFrontmatterBlock(raw: string): string {
  const parsed = matter(raw, MATTER_OPTIONS);
  return parsed.matter ?? '';
}

/* ------------------------------------------------------------------ */
/* 序列化：手写 emitter，保证字段顺序、引号策略与 git diff 稳定          */
/* ------------------------------------------------------------------ */

const POST_KEY_ORDER: Array<keyof PostFrontmatter> = [
  'title',
  'slug',
  'date',
  'updated',
  'tags',
  'categories',
  'cover',
  'coverAlt',
  'excerpt',
  'description',
  'keywords',
  'author',
  'lang',
  'pinned',
  'toc',
  'math',
  'comments',
  'hidden',
  'aliases',
  'series',
];

const PAGE_KEY_ORDER: Array<keyof PageFrontmatter> = [
  'title',
  'date',
  'updated',
  'description',
  'toc',
  'math',
];

function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

function emitScalar(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return quote(String(value));
}

function emitList(lines: string[], key: string, items: string[]): void {
  lines.push(`${key}:`);
  for (const item of items) lines.push(`  - ${quote(item)}`);
}

function buildFrontmatter(
  keys: string[],
  source: Record<string, unknown>,
  emit: (lines: string[], key: string, value: unknown) => void,
): string {
  const lines: string[] = ['---'];
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null) continue;
    emit(lines, key, value);
  }
  lines.push('---');
  return lines.join('\n');
}

export function stringifyPostSource(frontmatter: PostFrontmatter, body: string): string {
  const source = frontmatter as unknown as Record<string, unknown>;
  const head = buildFrontmatter(POST_KEY_ORDER as string[], source, (lines, key, value) => {
    if (Array.isArray(value)) {
      if (value.length > 0) emitList(lines, key, value as string[]);
      return;
    }
    if (key === 'pinned' || key === 'hidden') {
      if (value === true) lines.push(`${key}: true`);
      return;
    }
    if (key === 'toc' || key === 'comments') {
      if (value === false) lines.push(`${key}: false`);
      return;
    }
    if (key === 'math') {
      if (value !== 'auto') lines.push(`${key}: ${emitScalar(value)}`);
      return;
    }
    const str = String(value);
    if (str === '') return;
    lines.push(`${key}: ${emitScalar(value)}`);
  });

  return `${head}\n${normalizeBody(body).replace(/\s*$/, '')}\n`;
}

export function stringifyPageSource(frontmatter: PageFrontmatter, body: string): string {
  const source = frontmatter as unknown as Record<string, unknown>;
  const head = buildFrontmatter(PAGE_KEY_ORDER as string[], source, (lines, key, value) => {
    if (key === 'toc') {
      if (value === false) lines.push(`${key}: false`);
      return;
    }
    if (key === 'math') {
      if (value !== 'auto') lines.push(`${key}: ${emitScalar(value)}`);
      return;
    }
    const str = String(value);
    if (str === '') return;
    lines.push(`${key}: ${emitScalar(value)}`);
  });

  return `${head}\n${normalizeBody(body).replace(/\s*$/, '')}\n`;
}

/** 给后台表单用的空 frontmatter */
export function emptyPageFrontmatter(title: string, date: string): PageFrontmatter {
  return { title, date, toc: true, math: 'auto' };
}