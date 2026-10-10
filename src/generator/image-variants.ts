import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../util/hash';
import type { DistFile } from './writer';

export const VARIANT_WIDTHS = [480, 768, 1200];

const BITMAP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export interface VariantSource {
  /** 源文件绝对路径 */
  file: string;
  /** 站点内 URL（与渲染期改写结果一致） */
  url: string;
  /** dist 内相对 POSIX 路径 */
  outPath: string;
  width: number;
}

export interface PrepareResult {
  files: DistFile[];
  warnings: string[];
}

type SharpFactory = typeof import('sharp').default;

export function isBitmap(file: string): boolean {
  return BITMAP_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function insertWidth(target: string, width: number): string {
  const index = target.search(/[?#]/);
  const file = index < 0 ? target : target.slice(0, index);
  const suffix = index < 0 ? '' : target.slice(index);
  const ext = path.extname(file);
  return `${file.slice(0, -ext.length)}.w${width}${ext}${suffix}`;
}

async function loadSharp(): Promise<SharpFactory | null> {
  try {
    const mod = await import('sharp');
    return mod.default;
  } catch {
    return null;
  }
}

/**
 * 构建期多尺寸位图变体。
 * 先 register() 登记候选源，再 await prepare() 生成全部变体；此后 srcsetFor() 为同步查表，
 * 以适配同步的 markdown-it 渲染管线。
 */
export class VariantBuilder {
  private readonly sources = new Map<string, VariantSource>();
  private readonly srcsets = new Map<string, string>();
  private readonly files: DistFile[] = [];
  private readonly warnings: string[] = [];
  private prepared = false;

  constructor(private readonly cacheDir: string) {}

  /** 登记候选源；非位图或宽度不足以产生任何变体时忽略 */
  register(source: VariantSource): void {
    if (source.width <= VARIANT_WIDTHS[0]) return;
    if (!isBitmap(source.outPath)) return;
    this.sources.set(source.url, source);
  }

  async prepare(): Promise<PrepareResult> {
    if (this.prepared || this.sources.size === 0) return { files: [], warnings: [] };
    this.prepared = true;

    const sharp = await loadSharp();
    if (!sharp) {
      this.warnings.push('sharp 加载失败，跳过图片多尺寸变体（srcset）');
      return { files: [], warnings: this.warnings };
    }
    await fs.mkdir(this.cacheDir, { recursive: true });
    for (const source of this.sources.values()) await this.buildSource(sharp, source);
    return { files: this.files, warnings: this.warnings };
  }

  /** 同步查表；无变体或不适用时返回 undefined */
  srcsetFor(url: string): string | undefined {
    return this.srcsets.get(url);
  }

  private async buildSource(sharp: SharpFactory, source: VariantSource): Promise<void> {
    const widths = VARIANT_WIDTHS.filter((width) => width < source.width);
    if (widths.length === 0) return;

    const entries: Array<{ url: string; width: number }> = [];
    for (const width of widths) {
      const variant = await this.encode(sharp, source, width);
      if (variant) entries.push({ url: variant, width });
    }
    if (entries.length === 0) return;

    entries.push({ url: source.url, width: source.width });
    this.srcsets.set(
      source.url,
      entries.map((entry) => `${entry.url} ${entry.width}w`).join(', '),
    );
  }

  private async encode(
    sharp: SharpFactory,
    source: VariantSource,
    width: number,
  ): Promise<string | null> {
    try {
      const bytes = await fs.readFile(source.file);
      const ext = path.extname(source.outPath).toLowerCase();
      const cacheFile = path.join(
        this.cacheDir,
        `${sha1(Buffer.concat([bytes, Buffer.from(`w${width}`)]))}${ext}`,
      );

      let output: Buffer;
      try {
        output = await fs.readFile(cacheFile);
      } catch {
        output = await sharp(bytes).resize({ width, withoutEnlargement: true }).toBuffer();
        await fs.writeFile(cacheFile, output);
      }

      this.files.push({ outPath: insertWidth(source.outPath, width), content: output });
      return insertWidth(source.url, width);
    } catch (error) {
      this.warnings.push(
        `图片变体生成失败：${source.outPath} @${width}（${(error as Error).message}）`,
      );
      return null;
    }
  }
}