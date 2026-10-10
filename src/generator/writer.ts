import fs from 'node:fs/promises';
import path from 'node:path';
import { sha1 } from '../util/hash';
import { toPosix } from '../util/paths';
import { pool } from './pool';

export interface DistFile {
  /** dist 内相对 POSIX 路径 */
  outPath: string;
  content: string | Buffer;
}

export interface WriteResult {
  written: string[];
  removed: string[];
  unchanged: number;
}

/** dist 内容哈希表，用于跨次构建的增量写出 */
type HashTable = Record<string, string>;

async function readHashTable(file: string): Promise<HashTable> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as HashTable;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function pruneEmptyDirs(outDir: string): Promise<void> {
  const dirs: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const abs = path.join(dir, entry.name);
      dirs.push(abs);
      await walk(abs);
    }
  };
  await walk(outDir);
  dirs.sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    try {
      await fs.rmdir(dir);
    } catch {
      /* 非空或已被删除 */
    }
  }
}

/**
 * 收集本轮所有产物 → 与上次哈希表比对 → 只写变化文件、删除已消失文件。
 * 避免 git 全量重写，同时产出 changedUrls 供 SSE 精确刷新。
 */
export class DistWriter {
  private readonly files = new Map<string, DistFile>();
  private readonly hashes = new Map<string, string>();

  constructor(
    private readonly outDir: string,
    private readonly cacheFile: string,
  ) {}

  add(outPath: string, content: string | Buffer): void {
    const key = toPosix(outPath).replace(/^\/+/, '');
    this.files.set(key, { outPath: key, content });
    this.hashes.set(key, sha1(content));
  }

  get count(): number {
    return this.files.size;
  }

  async commit(concurrency: number): Promise<WriteResult> {
    const previous = await readHashTable(this.cacheFile);
    const written: string[] = [];
    const unchanged: string[] = [];

    for (const [outPath, hash] of this.hashes) {
      if (previous[outPath] === hash) unchanged.push(outPath);
      else written.push(outPath);
    }

    await fs.mkdir(this.outDir, { recursive: true });

    await pool(written, concurrency, async (outPath) => {
      const file = this.files.get(outPath)!;
      const abs = path.join(this.outDir, outPath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, file.content);
    });

    const removed: string[] = [];
    for (const outPath of Object.keys(previous)) {
      if (this.hashes.has(outPath)) continue;
      removed.push(outPath);
      await fs.rm(path.join(this.outDir, outPath), { force: true });
    }
    if (removed.length > 0) await pruneEmptyDirs(this.outDir);

    const next: HashTable = {};
    for (const [outPath, hash] of [...this.hashes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      next[outPath] = hash;
    }
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(this.cacheFile, JSON.stringify(next, null, 1), 'utf8');

    return { written, removed, unchanged: unchanged.length };
  }
}