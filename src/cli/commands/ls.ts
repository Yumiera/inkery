import { parseArgs } from 'node:util';
import { loadConfig } from '../../config/load';
import { scanContent } from '../../content/indexer';
import { toPostSummary } from '../../content/model';
import type { PostSummary } from '../../content/model';
import { color, log } from '../../util/logger';
import { padDisplay, truncate } from '../../util/text';

const STATE_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  scheduled: '定时',
};

function paintState(state: string, text: string): string {
  if (state === 'draft') return color.yellow(text);
  if (state === 'scheduled') return color.cyan(text);
  return color.green(text);
}

function sortSummaries(items: PostSummary[], sort: string, order: string): PostSummary[] {
  const dir = order === 'asc' ? 1 : -1;
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (sort) {
      case 'title':
        return a.title.localeCompare(b.title, 'zh-Hans-CN') * dir;
      case 'updated':
        return a.updated?.localeCompare(b.updated ?? '') ?? -1;
      case 'words':
        return (a.wordCount - b.wordCount) * dir;
      default:
        return a.date.localeCompare(b.date) * dir;
    }
  });
  return sorted;
}

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
      drafts: { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      tag: { type: 'string' },
      category: { type: 'string' },
      sort: { type: 'string', default: 'date' },
      order: { type: 'string', default: 'desc' },
      limit: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    log.plain('用法: npm run blog -- ls [--drafts] [--all] [--tag x] [--category y] [--json] [--limit N]');
    return 0;
  }

  const loaded = await loadConfig();
  const index = await scanContent(loaded);

  if (index.issues.length > 0) {
    log.warn(`${index.issues.length} 条内容问题：`);
    log.lines(
      index.issues.map((i) => `${color.dim(i.rel)} ${i.field ? color.gray(`[${i.field}]`) : ''} ${i.message}`),
    );
    log.blank();
  }

  const includeDrafts = values.drafts || values.all;
  const source = includeDrafts ? [...index.posts, ...index.drafts] : index.posts;

  let summaries = source.map(toPostSummary);
  if (values.tag) summaries = summaries.filter((s) => s.tags.includes(values.tag!));
  if (values.category) summaries = summaries.filter((s) => s.categories.includes(values.category!));
  summaries = sortSummaries(summaries, values.sort ?? 'date', values.order ?? 'desc');
  if (values.limit) summaries = summaries.slice(0, Number(values.limit));

  if (values.json) {
    log.plain(JSON.stringify(summaries, null, 2));
    return 0;
  }

  if (summaries.length === 0) {
    log.info('没有匹配的文章。');
    return 0;
  }

  const rows = summaries.map((s) => ({
    state: s.state,
    slug: s.slug,
    title: s.title,
    date: s.date.slice(0, 16),
    tags: s.tags.join(','),
    words: `${s.wordCount}字/${s.readingTime}分`,
  }));

  const w = {
    state: 6,
    slug: Math.min(32, Math.max(4, ...rows.map((r) => r.slug.length))),
    title: Math.min(40, Math.max(4, ...rows.map((r) => r.title.length))),
    tags: Math.min(24, Math.max(4, ...rows.map((r) => r.tags.length))),
  };

  log.plain(
    `  ${color.gray(padDisplay('状态', w.state))} ${color.gray(padDisplay('slug', w.slug))} ${color.gray(
      padDisplay('标题', w.title),
    )} ${color.gray('日期').padEnd(0)} ${color.gray(padDisplay('标签', w.tags))} ${color.gray('字数')}`,
  );

  for (const row of rows) {
    const label = padDisplay(STATE_LABEL[row.state] ?? row.state, w.state);
    log.plain(
      `  ${paintState(row.state, label)} ${color.cyan(padDisplay(row.slug, w.slug))} ${padDisplay(
        truncate(row.title, w.title),
        w.title,
      )} ${color.gray(row.date)} ${color.gray(padDisplay(row.tags, w.tags))} ${color.gray(row.words)}`,
    );
  }

  log.blank();
  log.plain(
    `  ${color.gray('共')} ${summaries.length} 篇` +
      (includeDrafts ? '' : `　${color.gray('（草稿未列出，用 --drafts 查看）')}`),
  );
  return 0;
}