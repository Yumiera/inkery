import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { log } from '../util/logger';

export type ConnectNext = (error?: unknown) => void;

export interface AdminDevMiddleware {
  /** Vite connect 中间件：未命中时回调 next */
  middlewares: (req: IncomingMessage, res: ServerResponse, next: ConnectNext) => void;
  close(): Promise<void>;
}

interface ViteLike {
  createServer(config: Record<string, unknown>): Promise<{
    middlewares: AdminDevMiddleware['middlewares'];
    close(): Promise<void>;
  }>;
}

/**
 * 后台 SPA 的 Vite 中间件模式接入（同一 http server，HMR 复用同一端口）。
 * admin/index.html 缺失（P5 之前）或未装 vite（--omit=dev）时返回 null，交由调用方兜底。
 */
export async function createAdminDevMiddleware(options: {
  adminDir: string;
  server: HttpServer;
}): Promise<AdminDevMiddleware | null> {
  if (!fs.existsSync(path.join(options.adminDir, 'index.html'))) return null;

  let vite: ViteLike;
  try {
    vite = (await import('vite')) as unknown as ViteLike;
  } catch {
    log.warn('未安装 vite（npm install --include=dev），/admin/ 墨台界面不可用');
    return null;
  }

  const instance = await vite.createServer({
    root: options.adminDir,
    base: '/admin/',
    appType: 'spa',
    server: {
      middlewareMode: true,
      hmr: { server: options.server },
      fs: { strict: false },
    },
  });

  return { middlewares: instance.middlewares, close: () => instance.close() };
}