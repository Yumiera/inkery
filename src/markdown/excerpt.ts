import { collapseWhitespace, stripHtml, truncate } from '../util/text';

/** 摘要分隔标记；渲染时原样透传为 HTML 注释，再据此切分 */
export const MORE_MARKER = '<!-- more -->';

const DEFAULT_LENGTH = 200;
const PARAGRAPH_RE = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/;

export interface ExcerptInput {
  /** frontmatter.excerpt，优先级最高 */
  explicit?: string;
  /** 标记之前的 HTML 片段 */
  introHtml?: string;
  /** 完整正文 HTML（无标记时取首段） */
  html: string;
  /** 最大显示宽度，默认 200 */
  maxLength?: number;
}

function textOf(html: string): string {
  return collapseWhitespace(stripHtml(html));
}

/** 从 HTML 生成摘要文本：excerpt > <!-- more --> 之前的内容 > 首段 */
export function buildExcerpt(input: ExcerptInput): string {
  const limit = input.maxLength ?? DEFAULT_LENGTH;

  const explicit = collapseWhitespace(input.explicit ?? '');
  if (explicit !== '') return truncate(explicit, limit);

  if (input.introHtml) {
    const intro = textOf(input.introHtml);
    if (intro !== '') return truncate(intro, limit);
  }

  const first = PARAGRAPH_RE.exec(input.html);
  const text = textOf(first ? first[1] : input.html);
  return truncate(text, limit);
}

/** 把摘要标记从正文中移除（保留其所在空行，避免行号漂移） */
export function stripMoreMarker(html: string): string {
  return html.split(MORE_MARKER).join('');
}

export function hasMoreMarker(source: string): boolean {
  return source.includes(MORE_MARKER);
}