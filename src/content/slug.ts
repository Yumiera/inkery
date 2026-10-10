import { hash8 } from '../util/hash';
import { isValidSlug, slugify } from '../util/text';

/** 框架自身占用的顶层路由段，文章 slug 不得与之冲突 */
const RESERVED_SEGMENTS = new Set([
  'posts',
  'drafts',
  'pages',
  'media',
  'static',
  'assets',
  'tags',
  'categories',
  'archives',
  'page',
  'search',
  'admin',
  'api',
  'aliases',
  'feed.xml',
  'atom.xml',
  'sitemap.xml',
  'robots.txt',
  '404.html',
  'index.html',
  '_posts',
  '_drafts',
]);

export class SlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SlugError';
  }
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SEGMENTS.has(slug.toLowerCase());
}

export function assertValidSlug(slug: string): void {
  if (!isValidSlug(slug)) {
    throw new SlugError(`非法 slug「${slug}」：只能由小写字母、数字和连字符组成，且不能以连字符开头或结尾`);
  }
  if (isReservedSlug(slug)) {
    throw new SlugError(`slug「${slug}」与框架路由冲突，请换一个`);
  }
}

export function assertValidResourceName(name: string): void {
  const base = name.split('/').pop() ?? '';
  if (base === '' || base.startsWith('.') || /[\\:*?"<>|]/.test(base)) {
    throw new SlugError(`非法资源名「${name}」`);
  }
}

/** 标题 -> 合法且未被占用的 slug；非 ASCII 标题退回 p-<标题哈希> */
export function makeUniqueSlug(input: string, taken: Set<string>): string {
  const base = slugify(input);
  const primary = base !== '' && !isReservedSlug(base) ? base : `p-${hash8(input)}`;

  if (!taken.has(primary)) return primary;

  for (let i = 2; i < 1000; i++) {
    const candidate = `${primary}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new SlugError(`无法为「${input}」生成唯一 slug`);
}

/** 资源文件名安全化：小写、空格与不安全字符转连字符，保留扩展名与 CJK */
export function sanitizeResourceName(name: string): string {
  const posix = name.replace(/\\/g, '/');
  const segments = posix.split('/').filter((s) => s !== '' && s !== '.' && s !== '..');
  const safe = segments.map((segment) => {
    const dot = segment.lastIndexOf('.');
    const ext = dot > 0 ? segment.slice(dot + 1).toLowerCase() : '';
    const stem = dot > 0 ? segment.slice(0, dot) : segment;
    const cleanedStem = stem
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[\\:*?"<>|#%&{}$!'@+`=]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '');
    const cleanedExt = ext.replace(/[^a-z0-9]+/g, '');
    if (cleanedStem === '') return cleanedExt ? `file.${cleanedExt}` : 'file';
    return cleanedExt ? `${cleanedStem}.${cleanedExt}` : cleanedStem;
  });
  const result = safe.join('/');
  if (result === '') throw new SlugError(`非法资源名「${name}」`);
  return result;
}

/** 重名时追加 8 位短哈希，保持扩展名 */
export function makeUniqueResourceName(name: string, taken: Set<string>, hash: string): string {
  const safe = sanitizeResourceName(name);
  if (!taken.has(safe.toLowerCase())) return safe;

  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  const candidate = `${stem}-${hash.slice(0, 8)}${ext}`;
  if (!taken.has(candidate.toLowerCase())) return candidate;

  for (let i = 2; i < 1000; i++) {
    const next = `${stem}-${hash.slice(0, 8)}-${i}${ext}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  throw new SlugError(`资源名冲突过多：${name}`);
}