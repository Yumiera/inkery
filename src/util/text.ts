const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const LATIN_RE = /[A-Za-z0-9_'-]+/g;

const CODE_FENCE_RE = /```[\s\S]*?```/g;
const HTML_TAG_RE = /<[^>]*>/g;

export function stripCode(text: string): string {
  return text.replace(CODE_FENCE_RE, ' ').replace(/~~~[\s\S]*?~~~/g, ' ');
}

export function stripHtml(text: string): string {
  return text
    .replace(HTML_TAG_RE, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function countCjk(text: string): number {
  return (text.match(CJK_RE) || []).length;
}

function countLatin(text: string): number {
  return (text.replace(CJK_RE, ' ').match(LATIN_RE) || []).length;
}

/** 中英混排字数：CJK 按字计、拉丁按词计 */
export function wordCount(text: string): number {
  const plain = stripHtml(stripCode(text));
  return countCjk(plain) + countLatin(plain);
}

/** 阅读时长（分钟，至少 1） */
export function readingTime(text: string): number {
  const plain = stripHtml(stripCode(text));
  const minutes = countCjk(plain) / 400 + countLatin(plain) / 220;
  return Math.max(1, Math.ceil(minutes));
}

/** 按显示宽度截断（CJK 记 2 宽），不切断代理对 */
export function truncate(text: string, maxWidth: number, ellipsis = '…'): string {
  let width = 0;
  let out = '';
  for (const ch of text) {
    const w = CJK_RE.test(ch) ? 2 : 1;
    CJK_RE.lastIndex = 0;
    if (width + w > maxWidth) return out.trimEnd() + ellipsis;
    width += w;
    out += ch;
  }
  return out;
}

/** 压缩空白，用于摘要与 meta description */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 生成 slug；丢弃非 ASCII 字符，返回空串时由调用方兜底 */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"’‘“”]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function isValidResourceName(name: string): boolean {
  const base = name.split('/').pop() ?? '';
  return base.length > 0 && !/[\\:*?"<>|]/.test(base) && !base.startsWith('.');
}

/** 把标题转成标签/分类的稳定标识 */
export function taxonomySlug(name: string): string {
  return slugify(name) || encodeURIComponent(name).toLowerCase().replace(/%/g, '');
}

export function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** 终端显示宽度：CJK 与全角符号记 2 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff);
    width += isWide ? 2 : 1;
  }
  return width;
}

/** 按显示宽度右填充空格 */
export function padDisplay(text: string, width: number): string {
  const pad = width - displayWidth(text);
  return pad > 0 ? text + ' '.repeat(pad) : text;
}