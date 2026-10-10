import fs from 'node:fs';
import http from 'node:http';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import path from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { Hono } from 'hono';
import type { LoadedConfig, LoadedHolder } from '../config/load';
import { ContentStore } from '../content/store';
import { MarkdownEngine } from '../markdown/renderer';
import { authMiddleware, createToken, tokenCookieMiddleware } from './auth';
import { reloadConfig } from './config-reload';
import { LiveReloadHub } from './live-reload';
import { BuildManager, createBuildRoutes } from './routes/build';
import { createAutosaveRoutes } from './routes/autosave';
import { DeployManager, createDeployRoutes } from './routes/deploy';
import { createConfigRoutes } from './routes/config';
import { createMediaRoutes } from './routes/media';
import { createMetaRoutes } from './routes/meta';
import { createPostRoutes } from './routes/posts';
import { createPreviewRoutes } from './routes/preview';
import { createRenderRoutes } from './routes/render';
import { createVerifyRoutes } from './routes/verify';
import { distRelPath, serveStaticPath } from './static';
import type { AdminDevMiddleware, ConnectNext } from './vite-mw';

export type ServerMode = 'dev' | 'prod';

export interface ServerContext extends LoadedHolder {
  mode: ServerMode;
  token: string;
  store: ContentStore;
  engine: MarkdownEngine;
  hub: LiveReloadHub;
  builds: BuildManager;
  deploys: DeployManager;
}

export interface CreateServerOptions {
  loaded: LoadedConfig;
  mode?: ServerMode;
  /** prod 下托管的后台产物目录（admin/dist） */
  adminDistDir?: string;
}

export interface BlogServerApp {
  app: Hono;
  token: string;
  hub: LiveReloadHub;
  builds: BuildManager;
  deploys: DeployManager;
  mode: ServerMode;
  /** 重新读取配置文件并刷新 store / engine（供墨台保存与文件监听复用） */
  reloadConfig(): Promise<void>;
  close(): Promise<void>;
}

/** 装配 Hono 应用：API + livereload + dist 预览兜底，不含 http 监听 */
export function createBlogServer(options: CreateServerOptions): BlogServerApp {
  const mode = options.mode ?? 'dev';
  const token = createToken();
  const hub = new LiveReloadHub();
  const store = new ContentStore(options.loaded);
  const engine = new MarkdownEngine(options.loaded);
  const ctx = {
    loaded: options.loaded,
    mode,
    token,
    store,
    engine,
    hub,
  } as ServerContext;
  ctx.builds = new BuildManager({ holder: ctx, hub });
  ctx.deploys = new DeployManager({ holder: ctx, hub, builds: ctx.builds });

  const app = new Hono();
  app.use('*', tokenCookieMiddleware(token));
  app.use('*', authMiddleware(token));

  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      mode,
      uptime: Math.round(process.uptime()),
      buildState: ctx.builds.state,
      liveReloadClients: hub.size,
    }),
  );
  app.get('/api/livereload', hub.handler);

  app.route('/api', createMetaRoutes(ctx));
  app.route('/api', createPostRoutes(ctx));
  app.route('/api', createRenderRoutes(ctx));
  app.route('/api', createAutosaveRoutes(ctx));
  app.route('/api', createMediaRoutes(ctx));
  app.route('/api', createBuildRoutes(ctx));
  app.route('/api', createDeployRoutes(ctx));
  app.route('/api', createConfigRoutes(ctx));
  app.route('/api', createVerifyRoutes(ctx));
  app.route('/api', createPreviewRoutes(ctx));
  app.all('/api/*', (c) =>
    c.json({ error: 'not_found', message: `未知 API：${c.req.method} ${c.req.path}` }, 404),
  );

  const adminDistDir = options.adminDistDir;
  if (mode === 'prod') {
    if (adminDistDir && fs.existsSync(path.join(adminDistDir, 'index.html'))) {
      app.get('/admin', (c) => c.redirect('/admin/'));
      app.get('/admin/*', (c) =>
        serveStaticPath(new URL(c.req.url).pathname, {
          root: adminDistDir,
          prefix: '/admin',
          spaFallback: 'index.html',
        }),
      );
    } else {
      app.all('/admin/*', (c) =>
        c.text('墨台界面未构建：请先执行 npm run build:admin', 404, {
          'Content-Type': 'text/plain; charset=utf-8',
        }),
      );
    }
  }

  app.notFound((c) =>
    serveStaticPath(distRelPath(new URL(c.req.url).pathname, ctx.loaded.config.site.baseUrl), {
      root: ctx.loaded.outDir,
      liveReload: true,
      notFoundFile: '404.html',
    }),
  );

  return {
    app,
    token,
    hub,
    builds: ctx.builds,
    deploys: ctx.deploys,
    mode,
    reloadConfig: async () => {
      await reloadConfig(ctx);
    },
    close: async () => {
      hub.closeAll();
    },
  };
}

export interface StartServerOptions extends CreateServerOptions {
  host: string;
  port: number;
  /** 拿到 http server 后创建附加中间件（Vite 需要同一 server 做 HMR）；返回 null 表示后台不可用 */
  attachAdmin?: (server: HttpServer) => Promise<AdminDevMiddleware | null>;
}

export interface RunningServer extends BlogServerApp {
  server: HttpServer;
  host: string;
  port: number;
  url: string;
}

/** 单进程单端口启动：API 与静态预览走 Hono，/admin/* 可选交给 Vite 中间件 */
export async function startServer(options: StartServerOptions): Promise<RunningServer> {
  const blog = createBlogServer(options);
  const server = http.createServer();
  const admin = options.attachAdmin ? await options.attachAdmin(server) : null;
  const listener = getRequestListener(blog.app.fetch);

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (admin && (url === '/admin' || url.startsWith('/admin/'))) {
      const next: ConnectNext = () => {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not Found');
      };
      admin.middlewares(req, res, next);
      return;
    }
    void listener(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(options.port, options.host, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  return {
    ...blog,
    server,
    host: options.host,
    port,
    url: `http://${options.host}:${port}`,
    close: async () => {
      blog.hub.closeAll();
      await admin?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}