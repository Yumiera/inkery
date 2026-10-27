import { parseArgs } from 'node:util';
import { loadConfig } from '../../config/load';
import { buildSite } from '../../generator/build';
import { relPath } from '../../util/paths';
import { color, log } from '../../util/logger';

const USAGE = '用法: npm run build [--clean] [--full] [--drafts] [--json]';

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      clean: { type: 'boolean', default: false },
      full: { type: 'boolean', default: false },
      'no-cache': { type: 'boolean', default: false },
      drafts: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    log.plain(USAGE);
    return 0;
  }

  const loaded = await loadConfig();
  const verbose = !values.quiet && !values.json;

  const result = await buildSite(loaded, {
    clean: values.clean,
    full: values.full || values['no-cache'],
    drafts: values.drafts,
    onProgress: verbose ? (progress) => log.debug(`[${progress.phase}] ${progress.message}`) : undefined,
  });

  const { stats } = result;

  if (values.json) {
    log.plain(JSON.stringify({ ...result, outDir: relPath(loaded.root, result.outDir) }, null, 2));
    return result.issues.length > 0 ? 1 : 0;
  }

  log.blank();
  log.kv('文章', `${stats.posts} 篇`);
  log.kv('页面', `${stats.pages} 个`);
  log.kv('路由', `${stats.routes} 条`);
  log.kv(
    '缓存',
    stats.cacheTotal === 0
      ? color.gray('未启用')
      : `${stats.cacheHits}/${stats.cacheTotal} 命中`,
  );
  const details: string[] = [];
  if (stats.unchanged > 0) details.push(`未变 ${stats.unchanged}`);
  if (stats.removed > 0) details.push(`删除 ${stats.removed}`);
  log.kv('写出', `${stats.written} 个文件${details.length > 0 ? color.gray(`（${details.join('，')}）`) : ''}`);
  log.kv('耗时', `${(stats.ms / 1000).toFixed(2)} s`);
  log.kv('输出', color.dim(relPath(loaded.root, result.outDir)));

  if (result.changedUrls.length > 0) {
    log.blank();
    log.plain(`  ${color.gray('变化页面')}`);
    for (const url of result.changedUrls.slice(0, 20)) log.plain(`    ${url}`);
    if (result.changedUrls.length > 20) {
      log.plain(color.gray(`    …另有 ${result.changedUrls.length - 20} 条`));
    }
  }

  if (result.warnings.length > 0) {
    log.blank();
    for (const warning of result.warnings) log.warn(warning);
  }

  if (result.issues.length > 0) {
    log.blank();
    log.error(`${result.issues.length} 条内容问题：`);
    for (const issue of result.issues) {
      const where = issue.field ? `${issue.rel} [${issue.field}]` : issue.rel;
      log.plain(`  ${color.yellow('|')} ${where} ${issue.message}`);
    }
    return 1;
  }

  log.blank();
  log.success(`构建完成 → ${relPath(loaded.root, result.outDir)}`);
  return 0;
}