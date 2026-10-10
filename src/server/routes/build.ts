import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { LoadedHolder } from '../../config/load';
import { buildSite } from '../../generator/build';
import type { BuildProgress } from '../../generator/build';
import { log } from '../../util/logger';
import type { BuildStatePayload, LiveReloadHub } from '../live-reload';
import type { ServerContext } from '../app';

const HISTORY_LIMIT = 32;

export interface BuildManagerDeps {
  holder: LoadedHolder;
  hub: LiveReloadHub;
}

export interface StartBuildOptions {
  clean?: boolean;
  drafts?: boolean;
  /** CLI 侧实时日志；SSE 广播不受影响 */
  onProgress?: (progress: BuildProgress) => void;
}

export interface StartBuildResult {
  id: string;
  reused: boolean;
  done: Promise<void>;
}

/**
 * 构建编排：单飞（同时只跑一个构建）+ 快照可查询 + SSE 广播进度。
 * 模板编译缓存按 文件+mtime 失效，因此本地服务沿用磁盘缓存做增量渲染即可。
 */
export class BuildManager {
  private current: BuildStatePayload | null = null;
  private running: Promise<void> | null = null;
  private readonly history = new Map<string, BuildStatePayload>();

  constructor(private readonly deps: BuildManagerDeps) {}

  get state(): 'idle' | 'running' | 'done' | 'error' {
    return this.current?.status ?? 'idle';
  }

  get latest(): BuildStatePayload | null {
    return this.current;
  }

  get(id: string): BuildStatePayload | null {
    return this.history.get(id) ?? null;
  }

  start(options: StartBuildOptions = {}): StartBuildResult {
    if (this.current?.status === 'running' && this.running) {
      return { id: this.current.id, reused: true, done: this.running };
    }

    const snapshot: BuildStatePayload = {
      id: randomUUID(),
      status: 'running',
      phase: 'scan',
      current: 0,
      total: 1,
      message: '准备构建',
      changedUrls: [],
      errors: [],
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.current = snapshot;
    this.remember(snapshot);
    this.deps.hub.broadcast({ type: 'build', state: { ...snapshot } });

    this.running = this.run(snapshot, options).finally(() => {
      this.running = null;
    });
    return { id: snapshot.id, reused: false, done: this.running };
  }

  private remember(snapshot: BuildStatePayload): void {
    this.history.set(snapshot.id, snapshot);
    if (this.history.size > HISTORY_LIMIT) {
      const oldest = [...this.history.keys()].slice(0, this.history.size - HISTORY_LIMIT);
      for (const id of oldest) this.history.delete(id);
    }
  }

  private publish(snapshot: BuildStatePayload): void {
    this.deps.hub.broadcast({ type: 'build', state: { ...snapshot } });
  }

  private async run(snapshot: BuildStatePayload, options: StartBuildOptions): Promise<void> {
    try {
      const result = await buildSite(this.deps.holder.loaded, {
        clean: options.clean,
        drafts: options.drafts,
        onProgress: (progress) => {
          snapshot.phase = progress.phase;
          snapshot.current = progress.current;
          snapshot.total = progress.total;
          snapshot.message = progress.message;
          this.publish(snapshot);
          options.onProgress?.(progress);
        },
      });
      snapshot.status = 'done';
      snapshot.phase = 'done';
      snapshot.message = `完成：写出 ${result.stats.written} 个文件，用时 ${(result.stats.ms / 1000).toFixed(2)}s`;
      snapshot.changedUrls = result.changedUrls;
      snapshot.finishedAt = Date.now();
      this.publish(snapshot);
      this.deps.hub.broadcast({ type: 'reload', urls: result.changedUrls });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      snapshot.status = 'error';
      snapshot.message = '构建失败';
      snapshot.errors.push(message);
      snapshot.finishedAt = Date.now();
      this.publish(snapshot);
      log.error(`构建失败：${message}`);
    }
  }
}

export function createBuildRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  app.post('/build', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { clean?: unknown; drafts?: unknown };
    const { id, reused } = ctx.builds.start({
      clean: body?.clean === true,
      drafts: typeof body?.drafts === 'boolean' ? body.drafts : undefined,
    });
    return c.json({ buildId: id, reused, state: ctx.builds.get(id) }, reused ? 200 : 202);
  });

  app.get('/build/:id', (c) => {
    const state = ctx.builds.get(c.req.param('id'));
    if (!state) return c.json({ error: 'not_found', message: '未知的 buildId' }, 404);
    return c.json(state);
  });

  return app;
}