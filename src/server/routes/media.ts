import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { imageSize } from 'image-size';
import { POST_INDEX_FILE, assetUrl, listDirFiles } from '../../content/store';
import { toPosix } from '../../util/paths';
import type { ServerContext } from '../app';
import { errorResponse } from './posts';

const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

function measure(data: Buffer): { width: number | null; height: number | null } {
  try {
    const size = imageSize(data);
    return { width: size.width ?? null, height: size.height ?? null };
  } catch {
    return { width: null, height: null };
  }
}

export function createMediaRoutes(ctx: ServerContext): Hono {
  const app = new Hono();
  const baseUrl = ctx.loaded.config.site.baseUrl;

  app.post('/media', async (c) => {
    try {
      const form = await c.req.parseBody();
      const file = form['file'];
      if (!(file instanceof File)) {
        return c.json({ error: 'invalid', message: 'multipart 里缺少 file 字段' }, 400);
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return c.json(
          { error: 'too_large', message: `文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 上限` },
          413,
        );
      }

      const scope = form['scope'] === 'global' ? 'global' : 'post';
      const slug = typeof form['slug'] === 'string' ? form['slug'].trim() : '';
      if (scope === 'post' && slug === '') {
        return c.json({ error: 'invalid', message: 'scope=post 时必须提供 slug' }, 400);
      }

      const data = Buffer.from(await file.arrayBuffer());
      const written = await ctx.store.writeMedia({
        filename: file.name || 'image',
        data,
        scope,
        slug: scope === 'post' ? slug : undefined,
        timeZone: ctx.loaded.config.site.timezone,
      });

      return c.json({ ...written, ...measure(data), name: path.posix.basename(written.relPath) }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get('/media', async (c) => {
    try {
      const scope = c.req.query('scope');
      const slug = (c.req.query('slug') ?? '').trim();

      if (scope === 'post' && slug !== '') {
        const found = await ctx.store.locate(slug);
        if (!found) return c.json({ error: 'not_found', message: `找不到文章：${slug}` }, 404);
        const names = await listDirFiles(found.dir, [POST_INDEX_FILE]);
        const items = await Promise.all(
          names.map(async (name) => {
            const abs = path.join(found.dir, name);
            const stat = await fs.stat(abs);
            const rel = toPosix(path.relative(ctx.loaded.contentDir, abs));
            return {
              name,
              relPath: rel,
              url: assetUrl(rel, baseUrl),
              size: stat.size,
              mtimeMs: stat.mtimeMs,
            };
          }),
        );
        return c.json({ items: items.sort((a, b) => b.mtimeMs - a.mtimeMs) });
      }

      return c.json({ items: await ctx.store.listMedia() });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}