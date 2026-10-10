import { z } from 'zod';
import { isValidTimezone } from '../util/dates';

export const navItemSchema = z.object({
  text: z.string().min(1, '导航项文字不能为空'),
  link: z.string().min(1, '导航项链接不能为空'),
});

export const socialItemSchema = z.object({
  name: z.string().min(1, '社交项名称不能为空'),
  link: z.string().min(1, '社交项链接不能为空'),
  icon: z.string(),
});

export const configSchema = z
  .object({
    site: z.object({
      title: z.string(),
      subtitle: z.string(),
      description: z.string(),
      keywords: z.array(z.string()),
      author: z.string(),
      email: z.string(),
      lang: z.string(),
      timezone: z.string(),
      url: z.string(),
      baseUrl: z.string(),
      logo: z.string(),
      favicon: z.string(),
      defaultCover: z.string(),
      footerHtml: z.string(),
      verify: z.object({
        google: z.string(),
        bing: z.string(),
        baidu: z.string(),
        yandex: z.string(),
      }),
    }),
    navigation: z.array(navItemSchema),
    social: z.array(socialItemSchema),
    permalinkPattern: z.string(),
    theme: z.object({
      name: z.string(),
      config: z.record(z.string(), z.unknown()),
    }),
    server: z.object({
      host: z.string(),
      port: z.number().int().min(1).max(65535),
      open: z.boolean(),
    }),
    build: z.object({
      outDir: z.string(),
      drafts: z.boolean(),
      cache: z.boolean(),
      concurrency: z.number().int().min(1).max(64),
      minify: z.boolean(),
      shiki: z.object({
        extraLangs: z.array(z.string()),
      }),
    }),
    deploy: z.object({
      type: z.literal('git'),
      enabled: z.boolean(),
      repo: z.string(),
      branch: z.string(),
      forcePush: z.boolean(),
      message: z.string(),
      cname: z.string(),
    }),
  })
  .superRefine((cfg, ctx) => {
    if (!cfg.permalinkPattern.includes(':slug')) {
      ctx.addIssue({
        code: 'custom',
        path: ['permalinkPattern'],
        message: '必须包含 :slug 占位符，例如 /posts/:slug/',
      });
    }
    if (!isValidTimezone(cfg.site.timezone)) {
      ctx.addIssue({
        code: 'custom',
        path: ['site', 'timezone'],
        message: `无效的时区：${cfg.site.timezone}`,
      });
    }
  });

export type Config = z.infer<typeof configSchema>;
export type NavItem = z.infer<typeof navItemSchema>;
export type SocialItem = z.infer<typeof socialItemSchema>;
export type ThemeConfig = Config['theme']['config'];
export type BuildConfig = Config['build'];
export type DeployConfig = Config['deploy'];

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[], file: string) {
    super(`配置校验失败（${file}）：\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '<根>';
    return `${path} — ${issue.message}`;
  });
}