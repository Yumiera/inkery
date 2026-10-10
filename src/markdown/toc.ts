import type { MarkdownIt, StateCore } from 'markdown-it';
import { hash8 } from '../util/hash';
import { slugify, stripHtml } from '../util/text';

export interface HeadingInfo {
  level: number;
  id: string;
  text: string;
  /** 源码行号（0 基） */
  line: number;
}

export interface TocItem extends HeadingInfo {
  children: TocItem[];
}

/**
 * CJK 友好的锚点：优先 ASCII slug；中文标题保留 Unicode 字母数字；
 * 仍为空则退化为短哈希，保证 id 稳定且可用于 URL fragment。
 */
export function anchorSlug(text: string): string {
  const plain = stripHtml(text).trim();
  if (plain === '') return '';

  const ascii = slugify(plain);
  if (ascii !== '') return ascii;

  const unicode = plain
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  return unicode !== '' ? unicode : `h-${hash8(plain)}`;
}

export function buildTocTree(headings: HeadingInfo[]): TocItem[] {
  const root: TocItem[] = [];
  const stack: TocItem[] = [];

  for (const heading of headings) {
    const item: TocItem = { ...heading, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop();
    if (stack.length === 0) root.push(item);
    else stack[stack.length - 1].children.push(item);
    stack.push(item);
  }

  return root;
}

export function flattenToc(items: TocItem[]): HeadingInfo[] {
  const out: HeadingInfo[] = [];
  for (const item of items) {
    out.push({ level: item.level, id: item.id, text: item.text, line: item.line });
    out.push(...flattenToc(item.children));
  }
  return out;
}

export interface TocPluginOptions {
  minLevel?: number;
  maxLevel?: number;
}

/**
 * 收集标题：必须在 markdown-it-anchor 之后挂载，才能读到已生成的 id。
 * 结果写入 env.headings / env.toc。
 */
export function tocPlugin(md: MarkdownIt, options: TocPluginOptions = {}): void {
  const minLevel = options.minLevel ?? 1;
  const maxLevel = options.maxLevel ?? 3;

  md.core.ruler.push('inkery_toc', (state: StateCore) => {
    const env = state.env as { headings?: HeadingInfo[]; toc?: TocItem[] };
    const headings: HeadingInfo[] = [];

    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type !== 'heading_open') continue;
      const level = Number(String(token.tag).slice(1));
      if (!Number.isFinite(level)) continue;
      const inline = state.tokens[i + 1];
      if (!inline || inline.type !== 'inline') continue;

      const id = String(token.attrGet('id') ?? '');
      const text = stripHtml(inline.content).trim();
      if (id === '' && text === '') continue;
      if (level < minLevel || level > maxLevel) continue;

      headings.push({ level, id, text, line: token.map ? token.map[0] : 0 });
    }

    env.headings = headings;
    env.toc = buildTocTree(headings);
    return true;
  });
}