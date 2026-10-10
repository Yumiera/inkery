import fs from 'node:fs/promises';
import path from 'node:path';
import * as esbuild from 'esbuild';
import type { LoadedConfig } from '../config/load';
import type { PostEntry } from '../content/model';
import { hash8, sha1 } from '../util/hash';
import { toPosix } from '../util/paths';
import { listDirFiles } from '../content/store';
import type { DistFile } from './writer';

export interface ThemeAssets {
  files: DistFile[];
  buildHash: string;
  /** 主题 CSS 的站点内路径 */
  cssHref: string;
  /** 打包后前端脚本的站点内路径 */
  jsSrc: string;
}

const SCRIPTS_ENTRY = 'scripts/app.ts';
const STYLES_ENTRY = 'styles/main.css';

async function walkAssets(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    out.push(toPosix(path.relative(dir, path.join(entry.parentPath, entry.name))));
  }
  return out.sort();
}

/** 主题静态资源 + esbuild 打包的前端脚本；不做内容哈希重命名，改用 ?v=buildHash 破缓存 */
export async function collectThemeAssets(
  loaded: LoadedConfig,
  options: { minify: boolean },
): Promise<ThemeAssets> {
  const assetsDir = path.join(loaded.themeDir, 'assets');
  const files: DistFile[] = [];
  const hashes: string[] = [];

  for (const rel of await walkAssets(assetsDir)) {
    if (rel.endsWith('.ts')) continue;
    const content = await fs.readFile(path.join(assetsDir, rel));
    files.push({ outPath: `assets/${rel}`, content });
    hashes.push(sha1(content));
  }

  let jsSrc = '';
  const entry = path.join(assetsDir, SCRIPTS_ENTRY);
  try {
    await fs.stat(entry);
  } catch {
    throw new Error(`主题缺少前端脚本入口：${toPosix(path.relative(loaded.root, entry))}`);
  }

  const built = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: options.minify,
    format: 'esm',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });
  const code = built.outputFiles[0]?.text ?? '';
  const name = `app.${hash8(code)}.js`;
  files.push({ outPath: `assets/${name}`, content: code });
  hashes.push(sha1(code));
  jsSrc = `/assets/${name}`;

  const buildHash = hash8(hashes.sort().join('|'));

  return { files, buildHash, cssHref: `/assets/${STYLES_ENTRY}`, jsSrc };
}

/**
 * 内容侧资源：全局媒体、文章附件、static 原样复制、.nojekyll。
 * 文章附件落在 /posts/<slug>/，与渲染期图片改写规则一致。
 */
export async function collectContentAssets(
  loaded: LoadedConfig,
  posts: readonly PostEntry[],
): Promise<DistFile[]> {
  const files: DistFile[] = [];
  const mediaDir = path.join(loaded.contentDir, 'media');
  const staticDir = path.join(loaded.contentDir, 'static');

  for (const rel of await listDirFiles(mediaDir)) {
    files.push({
      outPath: `media/${rel}`,
      content: await fs.readFile(path.join(mediaDir, rel)),
    });
  }

  for (const rel of await listDirFiles(staticDir)) {
    files.push({ outPath: rel, content: await fs.readFile(path.join(staticDir, rel)) });
  }

  for (const post of posts) {
    const slug = post.frontmatter.slug;
    for (const asset of post.assets) {
      files.push({
        outPath: `posts/${slug}/${asset}`,
        content: await fs.readFile(path.join(post.dir, asset)),
      });
    }
  }

  files.push({ outPath: '.nojekyll', content: '' });

  return files;
}