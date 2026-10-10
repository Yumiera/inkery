import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { assertValidSlug } from '../../content/slug';
import type { ServerContext } from '../app';
import { errorResponse } from './posts';

const putSchema = z.object({
  body: z.string(),
  frontmatter: z.record(z.string(), z.unknown()),
});

/** 编辑器崩溃恢复用的本地自动存档，落在 .cache/autosave/<slug>.json（不参与构建） */
export function createAutosaveRoutes(ctx: ServerContext): Hono {
  const app = new Hono();
  const dir = path.join(ctx.loaded.cacheDir, 'autosave');

  function fileOf(slug: string): string {
    assertValidSlug(slug);
    return path.join(dir, `${slug}.json`);
  }

  app.get('/autosave/:slug', async (c) => {
    try {
      const file = fileOf(c.req.param('slug') as string);
      const raw = await fs.readFile(file, 'utf8').catch(() => null);
      if (raw === null) return c.json({ exists: false });
      const parsed = JSON.parse(raw) as { savedAt?: number; body?: string; frontmatter?: unknown };
      return c.json({ exists: true, ...parsed });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.put('/autosave/:slug', async (c) => {
    try {
      const slug = c.req.param('slug') as string;
      const input = putSchema.parse(await c.req.json().catch(() => null));
      const file = fileOf(slug);
      await fs.mkdir(dir, { recursive: true });
      const savedAt = Date.now();
      await fs.writeFile(
        file,
        JSON.stringify({ slug, savedAt, body: input.body, frontmatter: input.frontmatter }),
        'utf8',
      );
      return c.json({ ok: true, savedAt });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.delete('/autosave/:slug', async (c) => {
    try {
      await fs.rm(fileOf(c.req.param('slug') as string), { force: true });
      return c.json({ ok: true });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}