import { randomUUID } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

export const TOKEN_COOKIE = 'blog_token';
export const TOKEN_HEADER = 'X-Blog-Token';

/** 无副作用的方法不做 Origin 校验 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createToken(): string {
  return randomUUID();
}

/** 令牌来源：请求头优先（SPA 读 cookie 后显式带上），其次 SameSite cookie（iframe / SSE） */
export function readToken(c: Context): string {
  const header = c.req.header(TOKEN_HEADER);
  if (header && header.trim() !== '') return header.trim();
  return getCookie(c, TOKEN_COOKIE) ?? '';
}

/**
 * 下发令牌 cookie。SameSite=Strict 保证跨站页面既发不出也读不到该 cookie；
 * 只在 cookie 缺失或不匹配时才写，避免每个响应都带 Set-Cookie。
 *
 * 必须在 next() 之后写：静态托管（prod 的 /admin/*）直接返回裸 Response，
 * 若在 next() 之前写，cookie 只会落在 preparedHeaders 上，不会被合并进该 Response。
 */
export function tokenCookieMiddleware(token: string): MiddlewareHandler {
  return async (c, next) => {
    const missing = readToken(c) !== token;
    await next();
    if (missing) {
      setCookie(c, TOKEN_COOKIE, token, { path: '/', sameSite: 'Strict' });
    }
  };
}

/** 修改性方法校验 Origin 与 Host 同源；无 Origin（CLI / curl）放行 */
export function isSameOrigin(c: Context): boolean {
  if (SAFE_METHODS.has(c.req.method)) return true;
  const origin = c.req.header('origin');
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return host !== '' && host === (c.req.header('host') ?? '');
}

/** 除 GET /api/meta 外所有 /api/* 都要令牌；修改性方法额外校验 Origin */
export function authMiddleware(token: string): MiddlewareHandler {
  return async (c, next) => {
    if (!c.req.path.startsWith('/api/')) {
      await next();
      return;
    }
    const publicMeta = c.req.method === 'GET' && c.req.path === '/api/meta';
    if (!publicMeta && readToken(c) !== token) {
      return c.json({ error: 'unauthorized', message: '缺少或错误的 X-Blog-Token' }, 401);
    }
    if (!isSameOrigin(c)) {
      return c.json({ error: 'forbidden', message: 'Origin 与服务不同源' }, 403);
    }
    await next();
  };
}