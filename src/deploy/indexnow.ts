import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_ENDPOINT = 'https://api.indexnow.org/indexnow';
const TIMEOUT_MS = 15_000;
const NOINDEX = /<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i;

export interface IndexNowOutcome {
  ok: boolean;
  status: number;
  submitted: number;
  message: string;
}

/** 收集产物中可提交的页面绝对 URL，跳过后台、404、隐藏目录与 noindex 页面 */
export async function collectPageUrls(
  outDir: string,
  siteUrl: string,
  baseUrl: string,
): Promise<string[]> {
  const root = `${siteUrl.replace(/\/+$/, '')}${baseUrl === '/' ? '/' : baseUrl}`;
  const entries = await fs.readdir(outDir, { recursive: true });
  const pages = entries
    .map((entry) => entry.split(path.sep).join('/'))
    .filter(
      (rel) =>
        rel.endsWith('.html') &&
        rel !== '404.html' &&
        !rel.startsWith('admin/') &&
        !rel.split('/').some((part) => part.startsWith('.')),
    );

  const indexable: string[] = [];
  for (const rel of pages) {
    const html = await fs.readFile(path.join(outDir, rel), 'utf8');
    if (NOINDEX.test(html)) continue;
    indexable.push(`${root}${rel.replace(/index\.html$/, '')}`);
  }
  return [...new Set(indexable)].sort();
}

/**
 * 提交 URL 到 IndexNow（Bing、Yandex、Seznam 共享入口）。
 * 失败只返回结论，不抛异常，避免影响部署结果。
 */
export async function submitIndexNow(options: {
  siteUrl: string;
  key: string;
  urls: string[];
  endpoint?: string;
}): Promise<IndexNowOutcome> {
  const base = options.siteUrl.replace(/\/+$/, '');
  const { key, urls } = options;
  if (urls.length === 0) {
    return { ok: false, status: 0, submitted: 0, message: 'IndexNow：没有可提交的页面' };
  }

  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    return { ok: false, status: 0, submitted: 0, message: `IndexNow：site.url 无法解析（${base}）` };
  }

  try {
    const response = await fetch(options.endpoint ?? DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation: `${base}/${key}.txt`, urlList: urls }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const status = response.status;
    if (status === 200 || status === 202) {
      return {
        ok: true,
        status,
        submitted: urls.length,
        message: `IndexNow 已提交 ${urls.length} 个 URL（HTTP ${status}）`,
      };
    }
    const text = (await response.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
    return {
      ok: false,
      status,
      submitted: 0,
      message: `IndexNow 提交被拒（HTTP ${status}）${text === '' ? '' : `：${text}`}`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, submitted: 0, message: `IndexNow 请求失败：${reason}` };
  }
}
