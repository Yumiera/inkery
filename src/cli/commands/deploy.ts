import { parseArgs } from 'node:util';
import { loadConfig } from '../../config/load';
import {
  DeployError,
  pagesUrl,
  publishDist,
  resolveDeploySettings,
  type DeployOverrides,
  type DeployPhase,
} from '../../deploy/publish';
import { buildSite } from '../../generator/build';
import { color, log } from '../../util/logger';

const USAGE = [
  '用法: npm run deploy [选项]',
  '',
  '  把 dist/ 产物推送到 Git 仓库（GitHub Pages、GitLab Pages 等）。',
  '  默认读取 blog.config.json 的 deploy 段，命令行参数可临时覆盖。',
  '',
  '选项',
  '  --repo <url>       目标仓库，支持 https/ssh 地址或 owner/repo 简写',
  '  --branch <name>    目标分支（默认取 deploy.branch）',
  '  --message <msg>    提交信息，支持 {{date}} 占位符',
  '  --cname <domain>   同时写出 CNAME 文件（自定义域名）',
  '  --no-force         不使用 --force 推送',
  '  --no-build         跳过构建，直接推送现有 dist/',
  '  --dry-run          只打印将要执行的内容，不做任何写操作',
  '  --json             以 JSON 输出结果（适合 CI）',
  '  -h, --help         显示本帮助',
].join('\n');

const PHASE_LABEL: Partial<Record<DeployPhase, string>> = {
  stage: '暂存',
  commit: '提交',
  push: '推送',
  indexnow: '索引',
};

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string' },
      branch: { type: 'string' },
      message: { type: 'string' },
      cname: { type: 'string' },
      'no-force': { type: 'boolean', default: false },
      'no-build': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    log.plain(USAGE);
    return 0;
  }

  const json = values.json;
  const loaded = await loadConfig();

  const overrides: DeployOverrides = {
    repo: values.repo,
    branch: values.branch,
    message: values.message,
    cname: values.cname,
    forcePush: values['no-force'] ? false : undefined,
  };
  const { settings, reason, warnings, enabled } = resolveDeploySettings(loaded, overrides);

  if (settings === null) {
    if (json) log.plain(JSON.stringify({ ok: false, enabled, error: reason }, null, 2));
    else log.error(reason);
    return 1;
  }

  const { repo, branch, forcePush, message, cname } = settings;
  const target = pagesUrl(repo, cname);

  if (!json) {
    for (const warning of warnings) log.warn(warning);
  }

  const dryRun = values['dry-run'];
  const skipBuild = values['no-build'];

  if (dryRun) {
    if (json) {
      log.plain(
        JSON.stringify(
          { ok: true, dryRun: true, repo, branch, forcePush, message, cname, pagesUrl: target, build: !skipBuild, warnings },
          null,
          2,
        ),
      );
      return 0;
    }
    log.blank();
    log.kv('仓库', repo);
    log.kv('分支', branch);
    log.kv('强制推送', forcePush ? '是' : '否');
    log.kv('提交信息', message);
    if (cname !== '') log.kv('CNAME', cname);
    if (target !== null) log.kv('访问地址', color.cyan(target));
    log.kv('构建', skipBuild ? color.gray('跳过') : '先执行构建');
    log.blank();
    log.success('dry-run 结束：未做任何写操作。');
    return 0;
  }

  let stats: { written: number; ms: number } | null = null;
  if (!skipBuild) {
    if (!json) log.step('构建站点…');
    const result = await buildSite(loaded, {
      onProgress: (progress) => log.debug(`[${progress.phase}] ${progress.message}`),
    });
    for (const warning of result.warnings) log.warn(warning);
    if (result.issues.length > 0) {
      if (json) {
        log.plain(
          JSON.stringify(
            { ok: false, error: '内容存在问题，已中止部署', issues: result.issues.map((i) => ({ rel: i.rel, message: i.message })) },
            null,
            2,
          ),
        );
        return 1;
      }
      log.error(`${result.issues.length} 条内容问题，已中止部署：`);
      for (const issue of result.issues) log.plain(`  ${color.yellow('|')} ${issue.rel} ${issue.message}`);
      return 1;
    }
    stats = result.stats;
    if (!json) log.success(`构建完成 | ${result.stats.written} 个文件写出`);
  }

  try {
    const result = await publishDist(loaded, settings, {
      inheritStdio: !json,
      hooks: {
        onPhase: (phase, text) => {
          const label = PHASE_LABEL[phase];
          if (!json && label) log.step(text);
        },
        onLog: (line) => {
          if (!json) log.plain(`  ${color.gray(line)}`);
        },
      },
    });

    if (json) {
      log.plain(
        JSON.stringify(
          {
            ok: true,
            repo: result.repo,
            branch: result.branch,
            committed: result.committed,
            message: result.message,
            pagesUrl: target,
            staging: result.stagingRel,
            build: stats,
            indexNow: result.indexNow,
            warnings,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    log.blank();
    log.kv('仓库', repo);
    log.kv('分支', branch);
    log.kv('提交', result.committed ? message : color.gray('产物无变化'));
    log.kv('暂存', color.dim(result.stagingRel));
    if (target !== null) log.kv('访问地址', color.cyan(target));
    log.blank();
    log.success('部署完成。');
    return 0;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (json) {
      log.plain(JSON.stringify({ ok: false, error: text, name: error instanceof DeployError ? 'DeployError' : 'Error' }, null, 2));
    } else {
      log.error(text);
    }
    return 1;
  }
}