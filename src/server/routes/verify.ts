import fs from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type { ServerContext } from '../app';
import { errorResponse } from './posts';

const MAX_UPLOAD_BYTES = 1024 * 1024;
const ALLOWED_EXTENSIONS = /\.(?:html?|xml|txt)$/i;

export interface VerifyFile {
  name: string;
  size: number;
  mtimeMs: number;
}

/**
 * 验证文件必须落在 content/static 根目录：无路径分隔符、非隐藏文件、扩展名受限。
 * 该目录会被原样拷贝到产物根目录，因此文件名即线上路径。
 */
function safeFileName(raw: string): string | null {
  const name = raw.trim();
  if (name === '' || name.length > 120) return null;
  if (name !== path.posix.basename(name)) return null;
  if (name.startsWith('.')) return null;
  if (/[\\/:*?"<>|]/.test(name)) return null;
  if (!ALLOWED_EXTENSIONS.test(name)) return null;
  return name;
}

/** 站点根目录静态文件（搜索平台验证文件）的列出、上传与删除 */
export function createVerifyRoutes(ctx: ServerContext): Hono {
  const app = new Hono();
  const staticDir = path.join(ctx.loaded.contentDir, 'static');

  const listFiles = async (): Promise<VerifyFile[]> => {
    let entries;
    try {
      entries = await fs.readdir(staticDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const items = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const stat = await fs.stat(path.join(staticDir, entry.name));
          return { name: entry.name, size: stat.size, mtimeMs: stat.mtimeMs };
        }),
    );
    return items.sort((left, right) => left.name.localeCompare(right.name));
  };

  app.get('/verify/files', async (c) => {
    try {
      return c.json({ dir: 'content/static', items: await listFiles() });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post('/verify/files', async (c) => {
    try {
      const form = await c.req.parseBody();
      const file = form['file'];
      if (!(file instanceof File)) {
        return c.json({ error: 'invalid', message: 'multipart 里缺少 file 字段' }, 400);
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return c.json(
          { error: 'too_large', message: `文件超过 ${MAX_UPLOAD_BYTES / 1024} KB 上限` },
          413,
        );
      }
      const name = safeFileName(file.name || '');
      if (name === null) {
        return c.json(
          {
            error: 'invalid',
            message: '文件名不合法：只接受根目录下的 .html / .htm / .xml / .txt 文件',
          },
          400,
        );
      }
      await fs.mkdir(staticDir, { recursive: true });
      await fs.writeFile(path.join(staticDir, name), Buffer.from(await file.arrayBuffer()));
      return c.json({ ok: true, dir: 'content/static', items: await listFiles() }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.delete('/verify/files/:name', async (c) => {
    try {
      const name = safeFileName(c.req.param('name'));
      if (name === null) {
        return c.json({ error: 'invalid', message: '文件名不合法' }, 400);
      }
      await fs.rm(path.join(staticDir, name), { force: true });
      return c.json({ ok: true, dir: 'content/static', items: await listFiles() });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  return app;
}