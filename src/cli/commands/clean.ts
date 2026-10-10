import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../../config/load';
import { color, log } from '../../util/logger';
import { relPath } from '../../util/paths';

async function removeIfExists(target: string, root: string): Promise<boolean> {
  try {
    await fs.rm(target, { recursive: true, force: true });
    log.success(`已删除 ${color.dim(relPath(root, target) || target)}`);
    return true;
  } catch (error) {
    log.error(`删除失败 ${color.dim(target)} — ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dist-only': { type: 'boolean', default: false },
      'cache-only': { type: 'boolean', default: false },
      all: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    log.plain('用法: npm run blog -- clean [--dist-only] [--cache-only] [--all]');
    return 0;
  }

  const loaded = await loadConfig();
  const targets: string[] = [];

  if (!values['cache-only']) targets.push(loaded.outDir);
  if (!values['dist-only']) targets.push(loaded.cacheDir);
  if (values.all) targets.push(path.join(loaded.root, '.deploy'));

  if (targets.length === 0) {
    log.warn('没有要清理的目标。');
    return 0;
  }

  let ok = true;
  for (const target of targets) {
    const removed = await removeIfExists(target, loaded.root);
    if (!removed) ok = false;
  }
  return ok ? 0 : 1;
}