import { Hono } from 'hono';
import { renderPreviewShell } from '../preview-shell';
import type { ServerContext } from '../app';

export function createPreviewRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  app.get('/preview/shell', (c) => c.html(renderPreviewShell(ctx.loaded)));

  return app;
}