import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeBaseUrl, toPosix } from '../util/paths';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

export function contentTypeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

const LIVE_RELOAD_SNIPPET =
  '<script>(function(){try{var es=new EventSource("/api/livereload");' +
  'es.onmessage=function(e){try{var d=JSON.parse(e.data);' +
  'if(d&&d.type==="reload"){location.reload();}}catch(x){}};}catch(x){}})();</script>';

export function injectLiveReload(html: string): string {
  if (html.includes('/api/livereload')) return html;
  const at = html.lastIndexOf('</body>');
  return at < 0 ? html + LIVE_RELOAD_SNIPPET : `${html.slice(0, at)}${LIVE_RELOAD_SNIPPET}${html.slice(at)}`;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 把 dist 内相对路径解析为磁盘文件；目录自动落到 index.html */
export async function resolveStaticFile(root: string, relPath: string): Promise<string | null> {
  const base = path.resolve(root);
  const rel = toPosix(relPath).replace(/^\/+/, '');
  const abs = path.resolve(base, rel);
  if (!isInside(base, abs)) return null;

  try {
    const stat = await fs.stat(abs);
    if (stat.isFile()) return abs;
    if (stat.isDirectory()) {
      const index = path.join(abs, 'index.html');
      const indexStat = await fs.stat(index).catch(() => null);
      if (indexStat?.isFile()) return index;
    }
  } catch {
    /* 不存在 */
  }
  return null;
}

export interface StaticOptions {
  /** 磁盘根目录（dist 或 admin/dist） */
  root: string;
  /** URL 前缀，如 '/admin'；留空表示挂在站点根 */
  prefix?: string;
  /** 注入 livereload 脚本（仅预览页需要） */
  liveReload?: boolean;
  /** 命中不到时的回退文件（相对 root），如 'index.html' 用于 SPA */
  spaFallback?: string;
  /** 未命中且无 SPA 回退时返回的页面（相对 root），如 '404.html' */
  notFoundFile?: string;
}

async function respond(file: string, status: number, liveReload: boolean): Promise<Response> {
  const data = await fs.readFile(file);
  if (contentTypeOf(file).startsWith('text/html')) {
    const html = data.toString('utf8');
    return new Response(liveReload ? injectLiveReload(html) : html, {
      status,
      headers: { 'Content-Type': contentTypeOf(file), 'Cache-Control': 'no-cache' },
    });
  }
  return new Response(new Uint8Array(data), {
    status,
    headers: { 'Content-Type': contentTypeOf(file), 'Cache-Control': 'no-cache' },
  });
}

/** 静态文件响应：URL 路径 -> root 内文件，支持 SPA 回退与 404 页 */
export async function serveStaticPath(urlPath: string, options: StaticOptions): Promise<Response> {
  let rel = urlPath;
  const prefix = (options.prefix ?? '').replace(/\/+$/, '');
  if (prefix !== '') {
    if (rel === prefix) rel = '/';
    else if (rel.startsWith(`${prefix}/`)) rel = rel.slice(prefix.length);
    else return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const target = await resolveStaticFile(options.root, rel);
  if (target) return respond(target, 200, options.liveReload === true);

  if (options.spaFallback) {
    const fallback = await resolveStaticFile(options.root, options.spaFallback);
    if (fallback) return respond(fallback, 200, options.liveReload === true);
  }

  if (options.notFoundFile) {
    const notFound = await resolveStaticFile(options.root, options.notFoundFile);
    if (notFound) return respond(notFound, 404, options.liveReload === true);
  }

  return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** 把站点 URL 路径折算成 dist 内相对路径（去掉 baseUrl 前缀） */
export function distRelPath(urlPath: string, baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl).replace(/\/+$/, '');
  if (base === '') return urlPath;
  if (urlPath === base) return '/';
  return urlPath.startsWith(`${base}/`) ? urlPath.slice(base.length) : urlPath;
}