import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../../config/load';
import { scanContent } from '../../content/indexer';
import type { PostEntry } from '../../content/model';
import { mathCacheSize } from '../../markdown/math';
import { MarkdownEngine, type RenderedDocument } from '../../markdown/renderer';
import { color, log } from '../../util/logger';

const USAGE =
  '用法: npm run blog -- render <slug> [--stats] [--stdout] [--out <file>] [--json] [--repeat N]';

function findEntry(
  index: Awaited<ReturnType<typeof scanContent>>,
  slug: string,
): PostEntry | undefined {
  const key = slug.toLowerCase();
  return [...index.posts, ...index.drafts].find((entry) => entry.frontmatter.slug.toLowerCase() === key);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function sizeOf(html: string): number {
  return Buffer.byteLength(html, 'utf8');
}

function countLevels(doc: RenderedDocument): string {
  const counts = new Map<number, number>();
  for (const heading of doc.headings) counts.set(heading.level, (counts.get(heading.level) ?? 0) + 1);
  const parts = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, count]) => `h${level} ×${count}`);
  return parts.length > 0 ? `${doc.headings.length} 条（${parts.join(' / ')}）` : '无';
}

function printReport(
  entry: PostEntry,
  doc: RenderedDocument,
  preloaded: string[],
  cold: RenderedDocument,
): void {
  const withSize = doc.images.filter((image) => image.width && image.height).length;

  log.blank();
  log.kv('标题', entry.frontmatter.title);
  log.kv('slug', entry.frontmatter.slug);
  log.kv('状态', entry.derived.state);
  log.kv('字数', `${doc.wordCount} 字 · 阅读 ${doc.readingTime} 分钟`);
  log.kv('TOC', countLevels(doc));
  log.kv('图片', doc.images.length === 0 ? '无' : `${doc.images.length} 张（${withSize} 张带尺寸）`);
  log.kv('预加载语言', preloaded.length === 0 ? '无' : preloaded.join(' / '));
  log.kv('命中语言', doc.usedLangs.length === 0 ? '无' : doc.usedLangs.join(' / '));
  log.kv('摘要', doc.excerpt === '' ? '无' : doc.excerpt);
  log.kv('HTML', formatBytes(sizeOf(doc.html)));
  log.kv('首次渲染', `${cold.elapsedMs.toFixed(2)} ms`);
  log.kv(
    '二次渲染',
    `${doc.elapsedMs.toFixed(2)} ms${doc.cached ? '（命中内存缓存）' : ''}　公式缓存 ${mathCacheSize()} 条`,
  );
  if (doc.warnings.length > 0) {
    log.kv('警告', doc.warnings.join('；'));
  }
  log.blank();
}

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      stats: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      stdout: { type: 'boolean', default: false },
      out: { type: 'string' },
      repeat: { type: 'string', default: '2' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    log.plain(USAGE);
    return 0;
  }

  const slug = positionals[0];
  if (!slug) {
    log.error('缺少 slug 参数');
    log.plain(`  ${color.gray(USAGE)}`);
    return 1;
  }

  const loaded = await loadConfig();
  const index = await scanContent(loaded);
  const entry = findEntry(index, slug);
  if (!entry) {
    log.error(`未找到文章：${color.bold(slug)}`);
    return 1;
  }

  const engine = new MarkdownEngine(loaded);
  const langs = await engine.prepare([entry.body]);

  const input = {
    body: entry.body,
    slug: entry.frontmatter.slug,
    assetDir: entry.dir,
    math: entry.frontmatter.math,
    toc: entry.frontmatter.toc,
    excerpt: entry.frontmatter.excerpt,
  };

  const coldDoc = engine.render(input);
  const passes = Math.max(1, Math.min(20, Number(values.repeat) || 1));
  let doc = coldDoc;
  for (let i = 1; i < passes; i++) doc = engine.render(input);

  const allWarnings = [...engine.highlighter.warnings, ...doc.warnings];
  if (values.json) {
    log.plain(JSON.stringify({ langs, ...doc, warnings: allWarnings }, null, 2));
    return 0;
  }

  if (values.stdout) {
    process.stdout.write(doc.html);
    return 0;
  }

  if (values.out !== undefined) {
    const target = path.resolve(loaded.root, values.out);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, doc.html, 'utf8');
    log.success(`已写入 ${color.cyan(path.relative(loaded.root, target))}`);
    if (values.stats) printReport(entry, doc, langs, coldDoc);
    return 0;
  }

  printReport(entry, doc, langs, coldDoc);
  if (allWarnings.length > 0) {
    log.lines(allWarnings.map((w) => color.yellow(w)));
    log.blank();
  }

  const target = path.join(loaded.cacheDir, 'render', `${entry.frontmatter.slug}.html`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, doc.html, 'utf8');
  log.plain(`  ${color.gray('HTML 已写入')} ${color.cyan(path.relative(loaded.root, target))}`);
  log.blank();
  return 0;
}