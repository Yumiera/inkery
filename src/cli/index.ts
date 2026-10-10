#!/usr/bin/env node
import { ConfigError } from '../config/schema';
import { color, log } from '../util/logger';
import { VERSION } from '../version';

interface CommandEntry {
  summary: string;
  usage: string;
  run: (argv: string[]) => Promise<number>;
}

const COMMANDS: Record<string, CommandEntry> = {
  dev: {
    summary: '启动墨台与站点预览（含 livereload）',
    usage: 'dev [--port 4321] [--host 127.0.0.1] [--prod] [--no-open] [--no-build]',
    run: async (argv) => (await import('./commands/dev')).run(argv),
  },
  config: {
    summary: '初始化或打印站点配置',
    usage: 'config [init] [print] [--force] [--json]',
    run: async (argv) => (await import('./commands/config')).run(argv),
  },
  clean: {
    summary: '清理构建产物与缓存',
    usage: 'clean [--dist-only] [--cache-only] [--all]',
    run: async (argv) => (await import('./commands/clean')).run(argv),
  },
  new: {
    summary: '新建文章或草稿',
    usage: 'new "标题" [--slug <slug>] [--draft] [--tags a,b] [--category x]',
    run: async (argv) => (await import('./commands/new')).run(argv),
  },
  ls: {
    summary: '列出文章',
    usage: 'ls [--drafts] [--all] [--tag x] [--category y] [--json]',
    run: async (argv) => (await import('./commands/ls')).run(argv),
  },
  build: {
    summary: '生成静态站点到 dist/',
    usage: 'build [--clean] [--full] [--drafts] [--json]',
    run: async (argv) => (await import('./commands/build')).run(argv),
  },
  deploy: {
    summary: '构建并推送到 Git 仓库（GitHub Pages 等）',
    usage:
      'deploy [--repo <url>] [--branch <name>] [--message <msg>] [--cname <domain>] [--no-force] [--no-build] [--dry-run] [--json]',
    run: async (argv) => (await import('./commands/deploy')).run(argv),
  },
  render: {
    summary: '渲染单篇文章的 Markdown（调试用）',
    usage: 'render <slug> [--stats] [--stdout] [--out <file>] [--json] [--repeat N]',
    run: async (argv) => (await import('./commands/render')).run(argv),
  },
};

function printHelp(): void {
  log.blank();
  log.plain(`  ${color.bold('Inkery')} ${color.gray(`v${VERSION}`)} — 可视化轻量级静态博客框架`);
  log.blank();
  log.plain(`  ${color.gray('用法')}  npm run blog -- <命令> [选项]`);
  log.blank();
  log.plain(`  ${color.gray('命令')}`);
  for (const [name, entry] of Object.entries(COMMANDS)) {
    log.plain(`    ${color.cyan(name.padEnd(10))} ${entry.summary}`);
  }
  log.blank();
  log.plain(`  ${color.gray('示例')}`);
  log.plain(`    ${color.dim('npm run dev')}                    启动墨台与预览`);
  log.plain(`    ${color.dim('npm run build')}                  生成静态站点到 dist/`);
  log.plain(`    ${color.dim('npm run deploy')}                 构建并推送到 Git 仓库`);
  log.blank();
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return 0;
  }
  if (command === '--version' || command === '-v') {
    log.plain(VERSION);
    return 0;
  }

  const entry = COMMANDS[command];
  if (!entry) {
    log.error(`未知命令：${color.bold(command)}`);
    log.plain(`  ${color.gray('可用命令')} ${Object.keys(COMMANDS).join('、')}`);
    return 1;
  }

  try {
    return await entry.run(argv.slice(1));
  } catch (error) {
    if (error instanceof ConfigError) {
      log.error(error.message);
      return 1;
    }
    if (error instanceof Error) {
      log.error(error.message);
      if (process.env.INKERY_DEBUG && error.stack) {
        log.plain(color.gray(error.stack));
      }
      return 1;
    }
    log.error(String(error));
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });