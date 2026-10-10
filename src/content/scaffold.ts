import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml';
import { log } from '../util/logger';
import type { PageFrontmatter, PostFrontmatter } from './model';

const YAML_ENGINE = {
  parse(source: string): object {
    const parsed = loadYaml(source, { schema: JSON_SCHEMA });
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as object) : {};
  },
  stringify(): string {
    return '';
  },
};

export type ScaffoldKind = 'post' | 'draft' | 'page';

export interface Scaffold {
  /** 脚手架里预置的默认字段（宽松解析，不校验） */
  defaults: Record<string, unknown>;
  /** 脚手架正文 */
  body: string;
}

const EMPTY: Scaffold = { defaults: {}, body: '' };

/** 读取 scaffolds/<kind>.md；缺失或损坏时退回空脚手架，不阻断新建流程 */
export async function loadScaffold(scaffoldDir: string, kind: ScaffoldKind): Promise<Scaffold> {
  const file = path.join(scaffoldDir, `${kind}.md`);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return EMPTY;
  }
  try {
    const parsed = matter(raw, { engines: { yaml: YAML_ENGINE } });
    return { defaults: parsed.data as Record<string, unknown>, body: parsed.content.replace(/^\s*\n+/, '') };
  } catch (error) {
    log.warn(`脚手架 ${file} 解析失败，已忽略：${error instanceof Error ? error.message : String(error)}`);
    return EMPTY;
  }
}

const POST_KNOWN_KEYS = new Set([
  'title',
  'slug',
  'date',
  'updated',
  'tags',
  'categories',
  'cover',
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
]);

/** 从脚手架 defaults 中提取可用于新建文章的字段（排除由调用方决定的 title/slug/date） */
export function scaffoldPostDefaults(scaffold: Scaffold): Partial<PostFrontmatter> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scaffold.defaults)) {
    if (!POST_KNOWN_KEYS.has(key)) continue;
    if (key === 'title' || key === 'slug' || key === 'date' || key === 'updated') continue;
    if (value === undefined || value === null) continue;
    out[key] = value;
  }
  return out as Partial<PostFrontmatter>;
}

export function scaffoldPageDefaults(scaffold: Scaffold): Partial<PageFrontmatter> {
  const out: Record<string, unknown> = {};
  for (const key of ['description', 'toc', 'math'] as const) {
    const value = scaffold.defaults[key];
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out as Partial<PageFrontmatter>;
}