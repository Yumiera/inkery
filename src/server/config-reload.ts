import { loadConfig, type LoadedConfig } from '../config/load';
import { ContentStore } from '../content/store';
import { MarkdownEngine } from '../markdown/renderer';
import type { ServerContext } from './app';

/**
 * 重新读取配置文件并就地刷新上下文里对配置的持有。
 * ContentStore 走 getter 读 baseUrl 等字段，MarkdownEngine 在构造时缓存 baseUrl 与 tocDepth，
 * 因此两者都需要重建，仅在 ctx 上替换 loaded 是不够的。
 */
export async function reloadConfig(ctx: ServerContext): Promise<LoadedConfig> {
  const next = await loadConfig({ configPath: ctx.loaded.configPath });
  ctx.loaded = next;
  ctx.store = new ContentStore(next);
  ctx.engine = new MarkdownEngine(next);
  return next;
}