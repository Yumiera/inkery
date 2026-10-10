import { createRequire } from 'node:module';
import type { MarkdownIt, StateBlock, StateInline } from 'markdown-it';
import { LruCache } from '../util/lru';
import { escapeHtml } from '../util/text';

/**
 * mathjax-full@3 是 CJS，用 createRequire 加载。
 * liteAdaptor + TeX + SVG 输出纯内联 SVG：无字体文件、无 CSS、无客户端 JS，
 * 暗色下靠 SVG 内的 currentColor 自动跟随。
 */
const require = createRequire(import.meta.url);

interface MathJaxRuntime {
  adaptor: { outerHTML: (node: unknown) => string };
  doc: { convert: (tex: string, options: Record<string, unknown>) => unknown };
}

let runtime: MathJaxRuntime | null = null;

function ensureRuntime(): MathJaxRuntime {
  if (runtime) return runtime;
  const { mathjax } = require('mathjax-full/js/mathjax.js');
  const { TeX } = require('mathjax-full/js/input/tex.js');
  const { SVG } = require('mathjax-full/js/output/svg.js');
  const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
  const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const doc = mathjax.document('', {
    InputJax: new TeX({ packages: AllPackages }),
    OutputJax: new SVG({ fontCache: 'local' }),
  });
  runtime = { adaptor, doc };
  return runtime;
}

/** 按「显示模式 + 公式源码」缓存，避免重复跑 MathJax */
const cache = new LruCache<string, string>(512);

export function mathCacheSize(): number {
  return cache.size;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** LaTeX → 内联 SVG 字符串 */
export function renderTex(tex: string, display: boolean): string {
  const key = `${display ? 'D' : 'I'}:${tex}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  let output: string;
  try {
    const { adaptor, doc } = ensureRuntime();
    const node = doc.convert(tex, { display, em: 16, ex: 8, containerWidth: 80 * 16 });
    const container = adaptor.outerHTML(node);
    const svg = /<svg[\s\S]*<\/svg>/.exec(container);
    output = svg ? svg[0] : container;
  } catch (error) {
    output = `<code class="math-error" title="${escapeHtml(messageOf(error))}">${escapeHtml(tex)}</code>`;
  }

  cache.set(key, output);
  return output;
}

export interface MathPluginOptions {
  /** 是否启用公式渲染；默认读 env.math */
  enabled?: (env: Record<string, unknown>) => boolean;
}

function isEnabled(env: unknown, options: MathPluginOptions): boolean {
  if (options.enabled) return options.enabled(env as Record<string, unknown>);
  const value = (env as { math?: unknown }).math;
  return value !== false;
}

function mathInline(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x24 /* $ */) return false;
  if (state.src.charCodeAt(start + 1) === 0x24) return false; // $$ 交给块级规则
  if (start > 0 && state.src.charCodeAt(start - 1) === 0x5c /* \ */) return false;

  let pos = start + 1;
  while (pos < state.posMax) {
    const code = state.src.charCodeAt(pos);
    if (code === 0x0a) return false; // 行内公式不跨行
    if (code === 0x5c) {
      pos += 2;
      continue;
    }
    if (code === 0x24) break;
    pos++;
  }
  if (pos >= state.posMax || state.src.charCodeAt(pos) !== 0x24) return false;

  const content = state.src.slice(start + 1, pos);
  if (content.trim() === '') return false;
  // 右定界符后紧邻数字视为金额（如 "$5 和 $10"），不当作公式
  if (/^\d/.test(state.src.slice(pos + 1, pos + 2))) return false;

  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.markup = '$';
    token.content = content;
  }
  state.pos = pos + 1;
  return true;
}

function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.src.slice(startPos, startPos + 2) !== '$$') return false;

  const firstLine = state.src.slice(startPos + 2, max);
  let found = false;
  let lastLine = startLine;
  let content = '';

  if (firstLine.trimEnd().endsWith('$$')) {
    content = firstLine.trimEnd().slice(0, -2);
    found = true;
  } else {
    const lines: string[] = [];
    if (firstLine.trim() !== '') lines.push(firstLine);
    for (let line = startLine + 1; line < endLine; line++) {
      const lineStart = state.bMarks[line] + state.tShift[line];
      const lineEnd = state.eMarks[line];
      const text = state.src.slice(lineStart, lineEnd);
      const trimmed = text.trimEnd();
      if (trimmed.endsWith('$$')) {
        lines.push(trimmed.slice(0, -2));
        lastLine = line;
        found = true;
        break;
      }
      lines.push(text);
    }
    content = lines.join('\n');
  }

  if (!found) return false;
  if (silent) return true;

  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.markup = '$$';
  token.content = content.trim();
  token.map = [startLine, lastLine + 1];
  state.line = lastLine + 1;
  return true;
}

export function mathPlugin(md: MarkdownIt, options: MathPluginOptions = {}): void {
  md.inline.ruler.before('escape', 'math_inline', (state, silent) =>
    isEnabled(state.env, options) ? mathInline(state, silent) : false,
  );

  md.block.ruler.before(
    'fence',
    'math_block',
    (state, startLine, endLine, silent) =>
      isEnabled(state.env, options) ? mathBlock(state, startLine, endLine, silent) : false,
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );

  md.renderer.rules.math_inline = (tokens, idx) => {
    const token = tokens[idx];
    return `<span class="math math-inline">${renderTex(token.content, false)}</span>`;
  };

  md.renderer.rules.math_block = (tokens, idx) => {
    const token = tokens[idx];
    const line = token.map ? ` data-src-line="${token.map[0]}"` : '';
    return `<div class="math math-display"${line}>${renderTex(token.content, true)}</div>\n`;
  };
}