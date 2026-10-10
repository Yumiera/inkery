import { parseArgs } from 'node:util';
import { loadConfig } from '../../config/load';
import { ContentStore } from '../../content/store';
import { toPostSummary } from '../../content/model';
import { color, log } from '../../util/logger';
import { toPosix } from '../../util/paths';

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      slug: { type: 'string' },
      kind: { type: 'string' },
      draft: { type: 'boolean', default: false },
      tags: { type: 'string' },
      category: { type: 'string' },
      date: { type: 'string' },
      excerpt: { type: 'string' },
      body: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    log.plain('用法: npm run blog -- new "标题" [--slug <slug>] [--draft] [--tags a,b] [--category x] [--date "YYYY-MM-DD HH:mm:ss"]');
    return 0;
  }

  const title = positionals.join(' ').trim();
  if (title === '') {
    log.error('缺少标题。示例：npm run blog -- new "我的第一篇文章"');
    return 1;
  }

  const kind = values.draft || values.kind === 'draft' ? 'draft' : 'post';
  if (values.kind && values.kind !== 'post' && values.kind !== 'draft') {
    log.error(`--kind 只能是 post 或 draft，收到：${values.kind}`);
    return 1;
  }

  const loaded = await loadConfig();
  const store = new ContentStore(loaded);

  const entry = await store.createPost({
    kind,
    title,
    slug: values.slug,
    date: values.date,
    tags: values.tags ? values.tags.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    categories: values.category ? [values.category] : undefined,
    excerpt: values.excerpt,
    body: values.body,
  });

  if (values.json) {
    log.plain(JSON.stringify(toPostSummary(entry), null, 2));
    return 0;
  }

  const summary = toPostSummary(entry);
  log.success(`已创建${kind === 'draft' ? '草稿' : '文章'}`);
  log.kv('标题', summary.title);
  log.kv('slug', color.cyan(summary.slug));
  log.kv('状态', summary.state === 'draft' ? color.yellow('草稿') : color.green('已发布'));
  log.kv('文件', color.dim(toPosix(`${entry.relDir}/${'index.md'}`)));
  log.kv('URL', summary.url);
  return 0;
}