import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG_FILENAME, defaultConfig } from '../../config/defaults';
import { loadConfig, serializeConfig } from '../../config/load';
import { color, log } from '../../util/logger';

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      force: { type: 'boolean', short: 'f', default: false },
      json: { type: 'boolean', default: false },
      path: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const sub = positionals[0] ?? 'print';

  if (values.help) {
    log.plain('用法: npm run blog -- config [init|print] [--force] [--json] [--path]');
    return 0;
  }

  if (sub === 'init') {
    const target = path.resolve(process.cwd(), CONFIG_FILENAME);
    let exists = false;
    try {
      await fs.access(target);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists && !values.force) {
      log.warn(`${CONFIG_FILENAME} 已存在，未覆盖。加 ${color.cyan('--force')} 强制重写。`);
      return 0;
    }
    await fs.writeFile(target, serializeConfig(defaultConfig), 'utf8');
    log.success(`已写入 ${color.dim(target)}`);
    return 0;
  }

  if (sub === 'print') {
    const loaded = await loadConfig();
    if (values.path) {
      log.plain(loaded.configPath);
      return 0;
    }
    if (values.json) {
      log.plain(serializeConfig(loaded.config).trimEnd());
      return 0;
    }
    const { config } = loaded;
    log.blank();
    log.plain(`  ${color.bold(config.site.title)} ${color.gray(config.site.url)}`);
    log.blank();
    log.kv('配置文件', color.dim(loaded.configPath));
    log.kv('基准路径', config.site.baseUrl);
    log.kv('时区', config.site.timezone);
    log.kv('永久链接', config.permalinkPattern);
    log.kv('主题', config.theme.name);
    log.kv('输出目录', color.dim(loaded.outDir));
    log.kv('草稿构建', config.build.drafts ? color.yellow('开启') : '关闭');
    log.kv(
      '部署',
      !config.deploy.enabled
        ? color.gray('未启用')
        : config.deploy.repo.trim() === ''
          ? color.yellow('已启用但缺少 repo')
          : `${color.green('已启用')} ${color.dim(`${config.deploy.repo} → ${config.deploy.branch}`)}`,
    );
    log.blank();
    return 0;
  }

  log.error(`未知子命令：${sub}`);
  log.plain(`  ${color.gray('可用')} init、print`);
  return 1;
}