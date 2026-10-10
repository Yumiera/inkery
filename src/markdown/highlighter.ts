import { createBundledHighlighter } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';
import { bundledThemes } from 'shiki/themes';
import { escapeHtml } from '../util/text';

const FALLBACK_LIGHT = 'github-light';
const FALLBACK_DARK = 'github-dark';

/** 不需要语法分析、直接按纯文本输出的语言 */
const PLAIN_LANGS = new Set(['text', 'txt', 'plain', 'plaintext', 'ansi']);

/**
 * 用 createBundledHighlighter 自建工厂：
 * - langs/themes 传 bundled 映射（本质是「按名字动态 import」），实现按需加载，dist 不含高亮运行时；
 * - engine 用 createJavaScriptRegexEngine，不加载 oniguruma WASM。
 */
const createShikiHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine(),
});

export type ShikiHighlighter = Awaited<ReturnType<typeof createShikiHighlighter>>;

export interface CodeThemeConfig {
  light: string;
  dark: string;
}

export interface HighlightResult {
  html: string;
  /** 实际使用的 shiki 语言 id */
  lang: string;
  /** 请求的语言未加载，已降级为纯文本 */
  fallback: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 进程内高亮单例。渲染阶段（同步）之前必须先 await init() 预加载语言集。
 */
export class Highlighter {
  private core: ShikiHighlighter | null = null;
  private starting: Promise<void> | null = null;
  private lightTheme = FALLBACK_LIGHT;
  private darkTheme = FALLBACK_DARK;
  private readonly notes = new Set<string>();

  constructor(theme?: Partial<CodeThemeConfig>) {
    if (theme?.light?.trim()) this.lightTheme = theme.light.trim();
    if (theme?.dark?.trim()) this.darkTheme = theme.dark.trim();
  }

  /** 实际生效的主题名（模板写 CSS class 用） */
  get themes(): CodeThemeConfig {
    return { light: this.lightTheme, dark: this.darkTheme };
  }

  get ready(): boolean {
    return this.core !== null;
  }

  /** 加载过的警告（未知语言、主题回退等），构建日志统一输出 */
  get warnings(): string[] {
    return [...this.notes];
  }

  async init(langs: Iterable<string> = []): Promise<void> {
    if (!this.core) {
      this.starting ??= this.create();
      await this.starting;
    }
    await this.load(langs);
  }

  private async create(): Promise<void> {
    this.lightTheme = this.resolveTheme(this.lightTheme, FALLBACK_LIGHT);
    this.darkTheme = this.resolveTheme(this.darkTheme, FALLBACK_DARK);
    this.core = await createShikiHighlighter({
      themes: this.uniqueThemes(),
      langs: [],
      warnings: false,
    });
  }

  private uniqueThemes(): string[] {
    return this.lightTheme === this.darkTheme ? [this.lightTheme] : [this.lightTheme, this.darkTheme];
  }

  private resolveTheme(name: string, fallback: string): string {
    if (name in bundledThemes) return name;
    this.note(`未知代码主题「${name}」，已回退为 ${fallback}`);
    return fallback;
  }

  /** 按需加载语言；返回本次真正新增的语言名 */
  async load(langs: Iterable<string>): Promise<string[]> {
    if (!this.core) await this.init();
    const core = this.core!;
    const added: string[] = [];

    for (const raw of langs) {
      const name = (raw ?? '').trim().toLowerCase();
      if (name === '' || PLAIN_LANGS.has(name) || this.has(name)) continue;
      if (!(name in bundledLanguages)) {
        this.note(`未知代码语言「${raw}」，已按纯文本处理`);
        continue;
      }
      try {
        await core.loadLanguage(name as never);
        added.push(name);
      } catch (error) {
        this.note(`代码语言「${raw}」加载失败：${messageOf(error)}`);
      }
    }
    return added;
  }

  has(lang: string): boolean {
    const key = (lang ?? '').trim().toLowerCase();
    if (PLAIN_LANGS.has(key)) return true;
    if (!this.core) return false;
    return this.core.getLoadedLanguages().includes(key);
  }

  /** 同步高亮：双主题 CSS 变量输出，前端零高亮 JS */
  highlight(code: string, lang: string): HighlightResult {
    const requested = (lang ?? '').trim().toLowerCase();
    const fallback = requested !== '' && !PLAIN_LANGS.has(requested) && !this.has(requested);
    const target = requested === '' || PLAIN_LANGS.has(requested) || fallback ? 'text' : requested;

    if (fallback) this.note(`未知代码语言「${lang}」，已按纯文本处理`);
    if (!this.core) return { html: this.plainHtml(code), lang: 'text', fallback: true };

    const html = this.core.codeToHtml(code, {
      lang: target as never,
      themes: { light: this.lightTheme, dark: this.darkTheme },
      defaultColor: false,
    });
    return { html, lang: target, fallback };
  }

  private plainHtml(code: string): string {
    return `<pre class="shiki"><code>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`;
  }

  private note(message: string): void {
    this.notes.add(message);
  }
}

/** 扫描正文中出现的代码围栏语言，用于构建前预加载 */
export function collectCodeLangs(markdown: string): string[] {
  const found = new Set<string>();
  for (const match of markdown.matchAll(/^(?:```|~~~)[ \t]*([^\s`~]*)/gm)) {
    const lang = match[1]?.trim().toLowerCase();
    if (lang) found.add(lang);
  }
  return [...found];
}