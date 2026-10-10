import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import chokidar from 'chokidar';
import { loadConfig } from '../../config/load';
import { startServer, type ServerMode } from '../../server/app';
import { createAdminDevMiddleware } from '../../server/vite-mw';
import { color, log } from '../../util/logger';
import { VERSION } from '../../version';

const USAGE =
  '用法: npm run dev [--port 4321] [--host 127.0.0.1] [--prod] [--no-open] [--no-build]';

const WATCH_IGNORE = /(^|[\\/])(node_modules|dist|\.deploy|\.cache|\.git)([\\/]|$)/;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* 打开失败不影响服务 */
  }
}

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: 'string' },
      port: { type: 'string' },
      prod: { type: 'boolean', default: false },
      open: { type: 'boolean' },
      'no-open': { type: 'boolean', default: false },
      'no-build': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    log.plain(USAGE);
    return 0;
  }

  const loaded = await loadConfig();
  const host = values.host ?? loaded.config.server.host;
  const portRaw = values.port ?? String(loaded.config.server.port);
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    log.error(`非法端口：${portRaw}`);
    return 1;
  }
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    log.warn(`已绑定 ${host}：同网段的其它设备可访问墨台，令牌校验挡不住同源伪造，请确认这是你的本意`);
  }

  const mode: ServerMode = values.prod ? 'prod' : 'dev';
  const adminDir = path.join(loaded.root, 'admin');
  const adminReady = fs.existsSync(path.join(adminDir, 'index.html'));

  let blog;
  try {
    blog = await startServer({
      loaded,
      mode,
      host,
      port,
      adminDistDir: path.join(adminDir, 'dist'),
      attachAdmin:
        mode === 'dev' ? (server) => createAdminDevMiddleware({ adminDir, server }) : undefined,
    });
  } catch (error) {
    log.error(`启动失败：${messageOf(error)}`);
    return 1;
  }

  if (!values['no-build']) {
    log.step('首次构建…');
    await blog.builds.start({ onProgress: (p) => log.debug(`[${p.phase}] ${p.message}`) }).done;
  }

  const build = blog.builds.latest;
  if (build && build.status === 'done') {
    log.success(`构建完成 · ${(build.finishedAt ?? 0) - build.startedAt} ms · ${build.changedUrls.length} 个 URL 变化`);
  } else if (build && build.status === 'error') {
    log.warn(`构建未成功：${build.errors.join('；')}（可在墨台点「构建」重试）`);
  }

  const watcher = chokidar.watch(
    [path.join(loaded.root, 'content'), path.join(loaded.root, 'themes'), loaded.configPath],
    {
      ignoreInitial: true,
      ignored: WATCH_IGNORE,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      atomic: true,
    },
  );

  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  let rebuilding = false;

  const flush = (): void => {
    timer = null;
    const changed = [...pending];
    pending.clear();
    if (rebuilding) {
      for (const file of changed) pending.add(file);
      return;
    }
    rebuilding = true;
    log.step(`变更：${changed.join('，')}`);
    void blog.builds
      .start({ onProgress: (p) => log.debug(`[${p.phase}] ${p.message}`) })
      .done.then(() => {
        const latest = blog.builds.latest;
        if (latest?.status === 'done') {
          log.success(`已重建 · ${latest.changedUrls.length} 个 URL 变化`);
        } else {
          log.error(`重建失败：${latest?.errors.join('；') ?? '未知错误'}`);
        }
        rebuilding = false;
        if (pending.size > 0 && timer === null) timer = setTimeout(flush, 200);
      });
  };

  watcher.on('all', (_event, file) => {
    pending.add(path.relative(loaded.root, file));
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 200);
  });
  watcher.on('error', (error) => log.warn(`文件监听出错：${messageOf(error)}`));

  log.blank();
  log.plain(`  ${color.bold('Inkery')} ${color.gray(`v${VERSION}`)} · ${mode}`);
  log.kv('Token', color.cyan(blog.token));
  log.kv('预览', color.cyan(`${blog.url}${loaded.config.site.baseUrl}`));
  log.kv('墨台', color.cyan(`${blog.url}/admin/`));
  log.kv('监听', color.dim('content/ themes/ blog.config.json'));
  if (mode === 'dev' && !adminReady) {
    log.warn('admin/index.html 尚未创建，/admin/ 墨台界面暂不可用');
  }
  log.blank();
  log.plain(color.gray('  Ctrl+C 退出'));

  const openTarget = values['no-open'] ? false : (values.open ?? loaded.config.server.open);
  if (openTarget) openBrowser(blog.url);

  let closing = false;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    log.blank();
    log.step('正在关闭…');
    await watcher.close().catch(() => undefined);
    await blog.close().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  return 0;
}