import path from 'node:path';

/** 把任意路径统一成 POSIX 正斜杠形式，作为所有 URL/slug/路由 key 的唯一出口 */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** 拼接 URL 片段，保证单斜杠、保留协议头与查询串 */
export function urlJoin(...parts: Array<string | undefined | null>): string {
  const cleaned = parts
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((p) => p.trim());
  if (cleaned.length === 0) return '/';

  let result = '';
  for (let i = 0; i < cleaned.length; i++) {
    let seg = cleaned[i];
    const isFirst = i === 0;
    const isLast = i === cleaned.length - 1;
    if (!isFirst) seg = seg.replace(/^\/+/, '');
    if (!isLast) seg = seg.replace(/\/+$/, '');
    if (seg === '') continue;
    if (isFirst) result = seg;
    else result = `${result.replace(/\/+$/, '')}/${seg}`;
  }
  if (result === '') return '/';
  return result.replace(/^([^/])/, '/$1');
}

/** 归一化 baseUrl：保证首尾都是 '/' */
export function normalizeBaseUrl(baseUrl: string): string {
  const t = (baseUrl || '/').trim();
  if (t === '' || t === '/') return '/';
  return `/${t.replace(/^\/+/, '').replace(/\/+$/, '')}/`;
}

/** 站点内绝对路径：toUrl('/posts/a/') -> '/posts/a/'；子路径部署时前缀 baseUrl */
export function toUrl(p: string, baseUrl = '/'): string {
  const base = normalizeBaseUrl(baseUrl);
  const joined = urlJoin(base, p);
  return joined;
}

/** 完整外链，用于 feed / sitemap / canonical */
export function absoluteUrl(siteUrl: string, p: string, baseUrl = '/'): string {
  const root = siteUrl.replace(/\/+$/, '');
  const rel = toUrl(p, baseUrl);
  return `${root}${rel === '/' ? '/' : rel}`;
}

/** 去掉开头斜杠，得到 dist 内的相对文件路径 */
export function urlToRelPath(url: string): string {
  return toPosix(url).replace(/^\/+/, '');
}

/** URL 里给文件名的安全编码：中文与空格统一 encodeURI，斜杠保留 */
export function encodeUrlPath(p: string): string {
  return toPosix(p)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

/** 显示用相对路径 */
export function relPath(from: string, to: string): string {
  return toPosix(path.relative(from, to));
}

export function isSubPath(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}