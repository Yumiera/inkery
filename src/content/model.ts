/**
 * 内容层的纯数据模型。
 * 所有进入模板与 API 的对象都必须是可序列化的普通数据，不允许携带引擎内部实例。
 */

export type PostState = 'draft' | 'published' | 'scheduled';
export type PostKind = 'post' | 'draft';

/** 落盘的 frontmatter 字段（emit 顺序即这里的顺序） */
export interface PostFrontmatter {
  title: string;
  slug: string;
  /** 'YYYY-MM-DD HH:mm:ss'，站点时区的墙上时间 */
  date: string;
  updated?: string;
  tags?: string[];
  categories?: string[];
  cover?: string;
  coverAlt?: string;
  excerpt?: string;
  description?: string;
  keywords?: string[];
  author?: string;
  lang?: string;
  pinned?: boolean;
  toc?: boolean;
  math?: boolean | 'auto';
  comments?: boolean;
  hidden?: boolean;
  aliases?: string[];
  series?: string;
}

export interface PageFrontmatter {
  title: string;
  date?: string;
  updated?: string;
  description?: string;
  toc?: boolean;
  math?: boolean | 'auto';
}

/** 派生字段，不落盘 */
export interface PostDerived {
  state: PostState;
  url: string;
  wordCount: number;
  readingTime: number;
  hash: string;
}

export interface PostEntry {
  kind: PostKind;
  frontmatter: PostFrontmatter;
  /** Markdown 正文（不含 frontmatter） */
  body: string;
  /** 文件绝对路径 */
  file: string;
  /** 目录绝对路径 */
  dir: string;
  /** 相对 content/ 的 POSIX 目录，如 posts/hello-world */
  relDir: string;
  /** 同目录下除 index.md 外的资源文件名 */
  assets: string[];
  derived: PostDerived;
}

export interface PageEntry {
  frontmatter: PageFrontmatter;
  body: string;
  file: string;
  dir: string;
  /** 相对 content/ 的 POSIX 路径，如 pages/about.md */
  relPath: string;
  /** 由相对路径推导的路由片段，如 about 或 guide/intro */
  pathname: string;
  url: string;
  assets: string[];
  derived: Pick<PostDerived, 'hash' | 'wordCount' | 'readingTime'>;
}

export interface MediaFile {
  /** 相对 content/ 的 POSIX 路径 */
  relPath: string;
  /** 对外 URL */
  url: string;
  size: number;
  mtimeMs: number;
}

export interface ContentIssue {
  /** 绝对路径；无关联文件时为空串 */
  file: string;
  /** 相对项目根，便于展示 */
  rel: string;
  field?: string;
  message: string;
}

export interface ContentIndex {
  /** content/posts 下的已发布文章 */
  posts: PostEntry[];
  /** content/drafts 下的草稿 */
  drafts: PostEntry[];
  pages: PageEntry[];
  media: MediaFile[];
  /** content/static 下需要原样复制的文件（相对该目录的 POSIX 路径） */
  staticFiles: string[];
  issues: ContentIssue[];
  /** 扫描耗时（毫秒） */
  elapsedMs: number;
}

export interface PostSummary {
  slug: string;
  title: string;
  date: string;
  updated?: string;
  tags: string[];
  categories: string[];
  cover: string;
  excerpt: string;
  state: PostState;
  kind: PostKind;
  url: string;
  wordCount: number;
  readingTime: number;
  pinned: boolean;
  hidden: boolean;
  hash: string;
}

export function toPostSummary(entry: PostEntry): PostSummary {
  const fm = entry.frontmatter;
  return {
    slug: fm.slug,
    title: fm.title,
    date: fm.date,
    updated: fm.updated,
    tags: fm.tags ?? [],
    categories: fm.categories ?? [],
    cover: fm.cover ?? '',
    excerpt: fm.excerpt ?? '',
    state: entry.derived.state,
    kind: entry.kind,
    url: entry.derived.url,
    wordCount: entry.derived.wordCount,
    readingTime: entry.derived.readingTime,
    pinned: fm.pinned === true,
    hidden: fm.hidden === true,
    hash: entry.derived.hash,
  };
}

/** 标签/分类聚合项 */
export interface TaxonomyTerm {
  name: string;
  slug: string;
  count: number;
}

export interface TaxonomyIndex {
  tags: TaxonomyTerm[];
  categories: TaxonomyTerm[];
}