import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { LoadedConfig } from '../config/load';
import { relPath } from '../util/paths';
import { collectPageUrls, submitIndexNow, type IndexNowOutcome } from './indexnow';

export const STAGING_DIR = '.deploy';

const GIT_TIMEOUT_MS = 10 * 60 * 1000;

export type DeployPhase = 'precheck' | 'stage' | 'commit' | 'push' | 'indexnow' | 'done';

export interface DeploySettings {
  repo: string;
  branch: string;
  forcePush: boolean;
  message: string;
  cname: string;
}

export interface DeployOverrides {
  repo?: string;
  branch?: string;
  message?: string;
  cname?: string;
  forcePush?: boolean;
}

export interface PublishHooks {
  onPhase?(phase: DeployPhase, message: string): void;
  onLog?(line: string): void;
}

export interface PublishResult {
  committed: boolean;
  message: string;
  repo: string;
  branch: string;
  stagingRel: string;
  indexNow: IndexNowOutcome | null;
}

export interface ResolvedDeploy {
  settings: DeploySettings | null;
  enabled: boolean;
  reason: string;
  warnings: string[];
}

export class DeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeployError';
  }
}

interface GitResult {
  ok: boolean;
  out: string;
}

function git(args: string[], cwd: string, inherit = false): GitResult {
  if (inherit) {
    const result = spawnSync('git', args, { cwd, stdio: 'inherit', windowsHide: true, timeout: GIT_TIMEOUT_MS });
    if (result.error) return { ok: false, out: result.error.message };
    return { ok: result.status === 0, out: '' };
  }
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) return { ok: false, out: result.error.message };
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { ok: result.status === 0, out };
}

/** owner/repo 简写补全为 GitHub https 地址，其余原样返回 */
export function normalizeRepo(repo: string): string {
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}.git` : repo;
}

/** 渲染 deploy.message 的 {{date}}：按站点时区输出 YYYY-MM-DD HH:mm:ss */
export function renderMessage(template: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  return template.replace(/\{\{date\}\}/g, parts.replace(',', ''));
}

/** site.url 仍是本地地址（部署后 RSS / sitemap / og:url 会指向本机） */
export function isLocalhostUrl(url: string): boolean {
  const value = url.trim();
  if (value === '') return true;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host.endsWith('.localhost');
  } catch {
    return true;
  }
}

/** 推导 GitHub Pages / 自定义域名的访问地址，无法识别时返回 null */
export function pagesUrl(repo: string, cname: string): string | null {
  const domain = cname.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (domain !== '') return `https://${domain}/`;

  const match = /^(?:https?:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(repo.trim());
  if (!match) return null;
  const owner = match[1].toLowerCase();
  const name = match[2];
  return name.toLowerCase() === `${owner}.github.io`
    ? `https://${owner}.github.io/`
    : `https://${owner}.github.io/${name}/`;
}

/** 合并 blog.config.json 的 deploy 段与命令行覆盖，并给出可部署性结论 */
export function resolveDeploySettings(loaded: LoadedConfig, overrides: DeployOverrides = {}): ResolvedDeploy {
  const { config } = loaded;
  const deploy = config.deploy;
  const warnings: string[] = [];

  if (!deploy.enabled && overrides.repo === undefined) {
    return {
      settings: null,
      enabled: false,
      reason: '部署未启用：把 blog.config.json 的 deploy.enabled 设为 true 并填写 deploy.repo，或用 --repo <url> 临时指定。',
      warnings,
    };
  }

  const repo = normalizeRepo((overrides.repo ?? deploy.repo).trim());
  const branch = (overrides.branch ?? deploy.branch).trim();
  const cname = (overrides.cname ?? deploy.cname).trim();
  const forcePush = overrides.forcePush ?? deploy.forcePush;
  const message = renderMessage(overrides.message ?? deploy.message, config.site.timezone);

  if (repo === '') {
    return {
      settings: null,
      enabled: true,
      reason: '缺少目标仓库：填写 deploy.repo（支持 owner/repo 简写）或用 --repo <url> 指定。',
      warnings,
    };
  }
  if (branch === '') {
    return {
      settings: null,
      enabled: true,
      reason: '目标分支不能为空：填写 deploy.branch 或用 --branch <name> 指定。',
      warnings,
    };
  }

  if (isLocalhostUrl(config.site.url)) {
    warnings.push(
      `site.url 仍是本地地址（${config.site.url || '空值'}），部署后 feed.xml / sitemap.xml / og:url 会指向本机。`,
    );
  }
  if (config.site.baseUrl !== '/') {
    warnings.push(
      `site.baseUrl 为 ${config.site.baseUrl}，主题资源的绝对路径未加前缀，子路径部署会 404；请部署到用户站点或自定义域名根路径。`,
    );
  }

  return { settings: { repo, branch, forcePush, message, cname }, enabled: true, reason: '', warnings };
}

async function hasRepo(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(dir, '.git'))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 把 dist/ 产物推送到 Git 仓库：stage → commit → push。
 * 构建由调用方负责（CLI 用 buildSite，服务端用 BuildManager）。
 */
export async function publishDist(
  loaded: LoadedConfig,
  settings: DeploySettings,
  options: { inheritStdio?: boolean; hooks?: PublishHooks } = {},
): Promise<PublishResult> {
  const { hooks = {}, inheritStdio = false } = options;
  const { config, root, outDir } = loaded;
  const stagingDir = path.join(root, STAGING_DIR);
  const stagingRel = relPath(root, stagingDir);

  hooks.onPhase?.('precheck', '检查环境与产物');
  const probe = git(['--version'], root);
  if (!probe.ok) throw new DeployError(`未找到可用的 git：${probe.out}`);

  try {
    await fs.access(path.join(outDir, 'index.html'));
  } catch {
    throw new DeployError(`未找到构建产物：先执行 npm run build（${relPath(root, outDir)}）`);
  }

  hooks.onPhase?.('stage', `暂存产物 → ${stagingRel}`);
  const reuse = await hasRepo(stagingDir);
  if (reuse) {
    for (const entry of await fs.readdir(stagingDir)) {
      if (entry === '.git') continue;
      await fs.rm(path.join(stagingDir, entry), { recursive: true, force: true });
    }
  } else {
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });
  }
  for (const entry of await fs.readdir(outDir)) {
    await fs.cp(path.join(outDir, entry), path.join(stagingDir, entry), { recursive: true });
  }
  if (settings.cname !== '') {
    await fs.writeFile(path.join(stagingDir, 'CNAME'), `${settings.cname}\n`, 'utf8');
  }

  const identity = [
    '-c',
    `user.name=${config.site.author.trim() || 'inkery'}`,
    '-c',
    `user.email=${config.site.email.trim() || 'inkery@localhost'}`,
  ];

  if (!reuse) {
    const init = git(['init', '-q'], stagingDir);
    if (!init.ok) throw new DeployError(`git init 失败：${init.out}`);
    git(['symbolic-ref', 'HEAD', `refs/heads/${settings.branch}`], stagingDir);
  }

  const add = git(['add', '-A'], stagingDir);
  if (!add.ok) throw new DeployError(`git add 失败：${add.out}`);

  hooks.onPhase?.('commit', settings.message);
  const status = git(['status', '--porcelain'], stagingDir);
  let committed = false;
  if (status.out === '') {
    hooks.onLog?.('产物与上次部署一致，无需提交');
  } else {
    const commit = git([...identity, 'commit', '-q', '-m', settings.message], stagingDir);
    if (!commit.ok) throw new DeployError(`git commit 失败：${commit.out}`);
    committed = true;
    hooks.onLog?.(`已提交：${settings.message}`);
  }

  const remote = git(['remote', 'get-url', 'origin'], stagingDir);
  const setRemote = git(
    remote.ok ? ['remote', 'set-url', 'origin', settings.repo] : ['remote', 'add', 'origin', settings.repo],
    stagingDir,
  );
  if (!setRemote.ok) throw new DeployError(`配置 origin 失败：${setRemote.out}`);

  hooks.onPhase?.('push', `推送 → ${settings.repo} (${settings.branch})${settings.forcePush ? ' | force' : ''}`);
  const pushArgs = ['push', ...(settings.forcePush ? ['--force'] : []), 'origin', `HEAD:refs/heads/${settings.branch}`];
  const push = git(pushArgs, stagingDir, inheritStdio);
  if (!push.ok) {
    throw new DeployError(
      inheritStdio
        ? '推送失败。检查仓库地址、分支与凭据（HTTPS 需 Personal Access Token，SSH 需已配置密钥），并确认远端分支未被保护。'
        : `推送失败：${push.out || '未知原因'}（检查仓库地址、分支与凭据，并确认远端分支未被保护）`,
    );
  }
  if (!inheritStdio && push.out !== '') hooks.onLog?.(push.out);

  let indexNow: IndexNowOutcome | null = null;
  const indexNowConfig = config.site.indexNow;
  if (indexNowConfig.enabled && indexNowConfig.key.trim() !== '' && committed) {
    if (isLocalhostUrl(config.site.url)) {
      hooks.onLog?.('IndexNow 已启用，但 site.url 仍是本地地址，跳过提交');
    } else {
      hooks.onPhase?.('indexnow', '提交 IndexNow');
      const urls = await collectPageUrls(outDir, config.site.url, config.site.baseUrl);
      indexNow = await submitIndexNow({
        siteUrl: config.site.url,
        key: indexNowConfig.key.trim(),
        urls,
      });
      hooks.onLog?.(indexNow.message);
    }
  }

  hooks.onPhase?.('done', '部署完成');
  return {
    committed,
    message: settings.message,
    repo: settings.repo,
    branch: settings.branch,
    stagingRel,
    indexNow,
  };
}