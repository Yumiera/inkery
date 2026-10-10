import fs from 'node:fs/promises';
import { Hono } from 'hono';
import { z } from 'zod';
import { defaultConfig } from '../../config/defaults';
import { deepMerge, type LoadedConfig } from '../../config/load';
import { configSchema, formatZodIssues } from '../../config/schema';
import { pagesUrl, resolveDeploySettings } from '../../deploy/publish';
import { normalizeBaseUrl, relPath } from '../../util/paths';
import { reloadConfig } from '../config-reload';
import type { ServerContext } from '../app';

const httpUrl = z
  .string()
  .trim()
  .refine((value) => value === '' || /^https?:\/\/[^\s]+$/i.test(value), '需为 http(s):// 开头的完整地址');

const verifyCode = z
  .string()
  .trim()
  .refine((value) => value === '' || /^[\w.\-+/=]+$/.test(value), '验证码只能包含字母、数字与 . - _ + / =');

const verifyPatch = z.object({
  google: verifyCode,
  bing: verifyCode,
  baidu: verifyCode,
  yandex: verifyCode,
});

const sitePatch = z.object({
  title: z.string().trim().min(1, '站点标题不能为空'),
  subtitle: z.string(),
  description: z.string(),
  keywords: z.array(z.string()),
  author: z.string(),
  email: z.string(),
  lang: z.string().trim().min(2, '语言代码不能为空（如 zh-CN）'),
  timezone: z.string().trim().min(1, '时区不能为空（如 Asia/Shanghai）'),
  url: httpUrl,
  baseUrl: z
    .string()
    .trim()
    .refine((value) => value === '' || value.startsWith('/'), '需以 / 开头，根路径写 /'),
  verify: verifyPatch,
});

const deployPatch = z.object({
  enabled: z.boolean(),
  repo: z.string().trim(),
  branch: z.string().trim().min(1, '目标分支不能为空'),
  forcePush: z.boolean(),
  message: z.string().trim().min(1, '提交信息不能为空'),
  cname: z.string().trim(),
});

const patchSchema = z.object({
  site: sitePatch.partial().optional(),
  deploy: deployPatch.partial().optional(),
});

type EditableSite = z.infer<typeof sitePatch>;
type EditableDeploy = z.infer<typeof deployPatch>;

function editableView(loaded: LoadedConfig) {
  const { site, deploy } = loaded.config;
  const resolved = resolveDeploySettings(loaded);
  return {
    site: {
      title: site.title,
      subtitle: site.subtitle,
      description: site.description,
      keywords: site.keywords,
      author: site.author,
      email: site.email,
      lang: site.lang,
      timezone: site.timezone,
      url: site.url,
      baseUrl: site.baseUrl,
      verify: site.verify,
    } satisfies EditableSite,
    deploy: {
      enabled: deploy.enabled,
      repo: deploy.repo,
      branch: deploy.branch,
      forcePush: deploy.forcePush,
      message: deploy.message,
      cname: deploy.cname,
    } satisfies EditableDeploy,
    configFile: relPath(loaded.root, loaded.configPath),
    preview: {
      deployable: resolved.settings !== null,
      pagesUrl: resolved.settings ? pagesUrl(resolved.settings.repo, resolved.settings.cname) : null,
      reason: resolved.reason,
      warnings: resolved.warnings,
    },
  };
}

async function readRawConfig(file: string): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(file, 'utf8');
  const data: unknown = JSON.parse(raw);
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

/** 站点基础配置 + 部署目标的读写，写入后热重载配置并重建 store/engine */
export function createConfigRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  app.get('/config', (c) => c.json(editableView(ctx.loaded)));

  app.put('/config', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsedPatch = patchSchema.safeParse(body);
    if (!parsedPatch.success) {
      return c.json(
        {
          error: 'invalid_config',
          message: '配置校验失败',
          issues: formatZodIssues(parsedPatch.error).map((text) => ({ message: text })),
        },
        400,
      );
    }
    const patch = parsedPatch.data;
    if (patch.site === undefined && patch.deploy === undefined) {
      return c.json({ error: 'invalid_config', message: '没有需要更新的字段' }, 400);
    }

    const configPath = ctx.loaded.configPath;
    let raw: Record<string, unknown>;
    try {
      raw = await readRawConfig(configPath);
    } catch (error) {
      return c.json(
        {
          error: 'invalid_config',
          message: `无法读取配置文件：${error instanceof Error ? error.message : String(error)}`,
        },
        500,
      );
    }

    const nextSite = { ...(raw.site as object | undefined), ...patch.site };
    if (typeof nextSite === 'object' && nextSite !== null && 'baseUrl' in nextSite) {
      const value = (nextSite as { baseUrl?: unknown }).baseUrl;
      if (typeof value === 'string') (nextSite as { baseUrl: string }).baseUrl = normalizeBaseUrl(value);
    }
    const nextRaw: Record<string, unknown> = {
      ...raw,
      ...(patch.site === undefined ? {} : { site: nextSite }),
      ...(patch.deploy === undefined ? {} : { deploy: { ...(raw.deploy as object | undefined), ...patch.deploy } }),
    };

    const parsedFull = configSchema.safeParse(deepMerge(defaultConfig, nextRaw));
    if (!parsedFull.success) {
      return c.json(
        {
          error: 'invalid_config',
          message: '配置校验失败',
          issues: formatZodIssues(parsedFull.error).map((message) => ({ message })),
        },
        400,
      );
    }

    await fs.writeFile(configPath, `${JSON.stringify(nextRaw, null, 2)}\n`, 'utf8');

    const next = await reloadConfig(ctx);

    const { id, reused } = ctx.builds.start();

    return c.json({
      ok: true,
      reused,
      buildId: id,
      ...editableView(next),
    });
  });

  return app;
}