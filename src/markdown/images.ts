import fs from 'node:fs';
import path from 'node:path';
import { imageSize } from 'image-size';
import type { MarkdownIt } from 'markdown-it';
import { encodeUrlPath, toUrl } from '../util/paths';

export interface ImageRecord {
  /** Markdown 里写的原始 src */
  original: string;
  /** 改写后的 src */
  src: string;
  /** 是否指向文章包内/站内资源 */
  local: boolean;
  exists: boolean;
  width?: number;
  height?: number;
}

export interface ImageEnv {
  slug?: string;
  /** 文章目录绝对路径，用于探测文件与读尺寸 */
  assetDir?: string;
  baseUrl?: string;
  images?: ImageRecord[];
  warnings?: string[];
  /** 构建期多尺寸变体查表；返回 undefined 表示该图无变体 */
  srcsetFor?: (src: string) => string | undefined;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/**
 * 图片 src 单点规则：
 * 以 `/`、`#`、`//` 或 `scheme:` 开头的一律不动（站内绝对路径、外链、data URI）；
 * 其余视为文章相对路径，改写为 `/posts/<slug>/<name>`；落盘保持原文件名。
 */
export function isPassthroughSrc(src: string): boolean {
  const value = src.trim();
  if (value === '') return true;
  return value.startsWith('/') || value.startsWith('#') || value.startsWith('//') || SCHEME_RE.test(value);
}

function splitSuffix(src: string): { file: string; suffix: string } {
  const index = src.search(/[?#]/);
  if (index < 0) return { file: src, suffix: '' };
  return { file: src.slice(0, index), suffix: src.slice(index) };
}

export function resolveImageSrc(src: string, env: ImageEnv): ImageRecord {
  if (isPassthroughSrc(src)) {
    return { original: src, src, local: false, exists: true };
  }

  const { file, suffix } = splitSuffix(src);
  const name = file.replace(/^\.\//, '').trim();

  if (name === '' || name.startsWith('..')) {
    return { original: src, src, local: false, exists: true };
  }

  const slug = (env.slug ?? '').trim();
  const prefix = slug === '' ? '' : `/posts/${slug}/`;
  const url = `${toUrl(`${prefix}${encodeUrlPath(name)}`, env.baseUrl ?? '/')}${suffix}`;

  let exists = false;
  let width: number | undefined;
  let height: number | undefined;

  if (env.assetDir) {
    const abs = path.join(env.assetDir, name);
    exists = fs.existsSync(abs);
    if (exists) {
      try {
        const size = imageSize(fs.readFileSync(abs));
        width = size.width;
        height = size.height;
      } catch {
        /* SVG 等无位图尺寸的格式：只输出 src */
      }
    } else {
      env.warnings?.push(`图片文件不存在：${name}`);
    }
  }

  return { original: src, src: url, local: true, exists, width, height };
}

/** 覆盖默认 image 规则：改写 src、补 width/height（消除 CLS）与懒加载 */
export function imagesPlugin(md: MarkdownIt): void {
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const scope = (env ?? {}) as ImageEnv;
    const record = resolveImageSrc(String(token.attrGet('src') ?? ''), scope);

    token.attrSet('src', record.src);
    token.attrSet('loading', 'lazy');
    token.attrSet('decoding', 'async');
    token.attrJoin('class', 'md-image');
    if (record.width && record.height) {
      token.attrSet('width', String(record.width));
      token.attrSet('height', String(record.height));
    }

    const srcset = record.local && record.exists ? scope.srcsetFor?.(record.src) : undefined;
    if (srcset) {
      token.attrSet('srcset', srcset);
      token.attrSet('sizes', '(max-width: 720px) 100vw, 720px');
    }

    const alt = self.renderInlineAsText(token.children ?? [], options, env);
    const altIndex = token.attrIndex('alt');
    if (altIndex >= 0 && token.attrs) token.attrs[altIndex][1] = alt;
    else token.attrSet('alt', alt);

    scope.images?.push(record);
    return self.renderToken(tokens, idx, options);
  };
}