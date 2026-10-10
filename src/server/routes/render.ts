import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ServerContext } from '../app';
import { errorResponse } from './posts';

const renderSchema = z.object({
  markdown: z.string().optional(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  math: z.union([z.boolean(), z.literal('auto')]).optional(),
  toc: z.boolean().optional(),
});

/** 实时预览：复用生产渲染管线与 LRU，只做单文档渲染 */
export function createRenderRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  app.post('/render', async (c) => {
    try {
      const input = renderSchema.parse(await c.req.json().catch(() => ({})));
      const markdown = input.markdown ?? '';
      const fm = input.frontmatter ?? {};
      const slug = typeof fm.slug === 'string' ? fm.slug.trim() : '';
      const found = slug === '' ? null : await ctx.store.locate(slug);
      const assetDir = found?.dir ?? path.join(ctx.store.postsDir, slug === '' ? '_preview' : slug);

      const fmMath = fm.math;
      const math =
        input.math ?? (fmMath === true || fmMath === false || fmMath === 'auto' ? fmMath : 'auto');

      await ctx.engine.prepare([markdown]);
      const doc = ctx.engine.render({
        body: markdown,
        slug,
        assetDir,
        math,
        toc: input.toc ?? fm.toc !== false,
        excerpt: typeof fm.excerpt === 'string' ? fm.excerpt : undefined,
      });

      return c.json({
        html: doc.html,
        toc: doc.toc,
        headings: doc.headings,
        excerpt: doc.excerpt,
        wordCount: doc.wordCount,
        readingTime: doc.readingTime,
        images: doc.images,
        warnings: doc.warnings,
        cached: doc.cached,
        elapsed: doc.elapsedMs,
      });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}