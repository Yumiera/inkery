import type { PostView } from './template';

export interface SearchDoc {
  title: string;
  url: string;
  date: string;
  updated: string;
  tags: string[];
  categories: string[];
  excerpt: string;
  /** 渲染后正文的纯文本 */
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  laquo: '«',
  raquo: '»',
};

/** 渲染后的 HTML 转纯文本：去标签、解实体、压缩空白，供搜索匹配用 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
      if (body.startsWith('#')) {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** 搜索索引：只收列表可见文章，字段顺序固定以保证构建幂等（不含时间戳） */
export function renderSearchIndex(posts: readonly PostView[]): string {
  const docs: SearchDoc[] = posts.map((post) => ({
    title: post.title,
    url: post.url,
    date: post.date,
    updated: post.updated,
    tags: post.tags.map((tag) => tag.name),
    categories: post.categories.map((item) => item.name),
    excerpt: post.excerpt,
    text: htmlToText(post.html),
  }));
  return `${JSON.stringify({ docs })}\n`;
}