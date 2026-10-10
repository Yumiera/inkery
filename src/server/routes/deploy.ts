import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { LoadedHolder } from '../../config/load';
import {
  DeployError,
  pagesUrl,
  publishDist,
  resolveDeploySettings,
  type DeployOverrides,
  type DeploySettings,
} from '../../deploy/publish';
import { log } from '../../util/logger';
import type { BuildManager } from './build';
import type { DeployStatePayload, LiveReloadHub } from '../live-reload';
import type { ServerContext } from '../app';

const HISTORY_LIMIT = 16;
const LOG_LIMIT = 200;

export interface DeployManagerDeps {
  holder: LoadedHolder;
  hub: LiveReloadHub;
  builds: BuildManager;
}

export interface StartDeployResult {
  id: string;
  reused: boolean;
  done: Promise<void>;
}

/**
 * 部署编排：复用 BuildManager 的构建进度，随后 stage → commit → push，全程 SSE 广播。
 * 单飞：部署进行中再次触发会复用同一个任务。
 */
export class DeployManager {
  private current: DeployStatePayload | null = null;
  private running: Promise<void> | null = null;
  private readonly history = new Map<string, DeployStatePayload>();

  constructor(private readonly deps: DeployManagerDeps) {}

  get state(): 'idle' | 'running' | 'done' | 'error' {
    return this.current?.status ?? 'idle';
  }

  get latest(): DeployStatePayload | null {
    return this.current;
  }

  get(id: string): DeployStatePayload | null {
    return this.history.get(id) ?? null;
  }

  start(overrides: DeployOverrides = {}, options: { skipBuild?: boolean } = {}): StartDeployResult {
    if (this.current?.status === 'running' && this.running) {
      return { id: this.current.id, reused: true, done: this.running };
    }

    const { settings, reason } = resolveDeploySettings(this.deps.holder.loaded, overrides);
    if (settings === null) throw new DeployError(reason);

    const snapshot: DeployStatePayload = {
      id: randomUUID(),
      status: 'running',
      phase: 'build',
      message: options.skipBuild ? '跳过构建' : '准备构建',
      buildId: null,
      committed: null,
      log: [],
      errors: [],
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.current = snapshot;
    this.remember(snapshot);
    this.publish(snapshot);

    this.running = this.run(snapshot, settings, options).finally(() => {
      this.running = null;
    });
    return { id: snapshot.id, reused: false, done: this.running };
  }

  private remember(snapshot: DeployStatePayload): void {
    this.history.set(snapshot.id, snapshot);
    if (this.history.size > HISTORY_LIMIT) {
      const oldest = [...this.history.keys()].slice(0, this.history.size - HISTORY_LIMIT);
      for (const id of oldest) this.history.delete(id);
    }
  }

  private publish(snapshot: DeployStatePayload): void {
    this.deps.hub.broadcast({ type: 'deploy', state: { ...snapshot, log: [...snapshot.log] } });
  }

  private append(snapshot: DeployStatePayload, line: string): void {
    snapshot.log.push(line);
    if (snapshot.log.length > LOG_LIMIT) snapshot.log.splice(0, snapshot.log.length - LOG_LIMIT);
  }

  private async run(
    snapshot: DeployStatePayload,
    settings: DeploySettings,
    options: { skipBuild?: boolean },
  ): Promise<void> {
    try {
      if (!options.skipBuild) {
        snapshot.phase = 'build';
        snapshot.message = '构建站点…';
        this.publish(snapshot);
        const build = this.deps.builds.start({
          onProgress: (progress) => {
            snapshot.message = `${progress.message}（${progress.current}/${progress.total}）`;
            this.publish(snapshot);
          },
        });
        snapshot.buildId = build.id;
        this.publish(snapshot);
        await build.done;
        const final = this.deps.builds.get(build.id);
        if (final?.status !== 'done') {
          throw new DeployError(final?.errors[0] ?? '构建失败，已中止部署');
        }
        this.append(snapshot, final.message);
      }

      const result = await publishDist(this.deps.holder.loaded, settings, {
        hooks: {
          onPhase: (phase, message) => {
            snapshot.phase = phase;
            snapshot.message = message;
            this.publish(snapshot);
          },
          onLog: (line) => {
            this.append(snapshot, line);
            this.publish(snapshot);
          },
        },
      });

      snapshot.status = 'done';
      snapshot.phase = 'done';
      snapshot.committed = result.committed;
      snapshot.message = result.committed ? `已部署：${result.message}` : '产物无变化，远端已是最新';
      const target = pagesUrl(result.repo, settings.cname);
      if (target !== null) this.append(snapshot, `访问地址：${target}`);
      snapshot.finishedAt = Date.now();
      this.publish(snapshot);
      log.success(`部署完成 → ${result.repo} (${result.branch})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      snapshot.status = 'error';
      snapshot.message = '部署失败';
      snapshot.errors.push(message);
      snapshot.finishedAt = Date.now();
      this.publish(snapshot);
      log.error(`部署失败：${message}`);
    }
  }
}

export function createDeployRoutes(ctx: ServerContext): Hono {
  const app = new Hono();

  app.post('/deploy', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      repo?: unknown;
      branch?: unknown;
      message?: unknown;
      cname?: unknown;
      skipBuild?: unknown;
    };
    const overrides: DeployOverrides = {};
    if (typeof body?.repo === 'string' && body.repo.trim() !== '') overrides.repo = body.repo.trim();
    if (typeof body?.branch === 'string' && body.branch.trim() !== '') overrides.branch = body.branch.trim();
    if (typeof body?.message === 'string' && body.message.trim() !== '') overrides.message = body.message.trim();
    if (typeof body?.cname === 'string') overrides.cname = body.cname.trim();

    try {
      const { id, reused } = ctx.deploys.start(overrides, { skipBuild: body?.skipBuild === true });
      return c.json({ deployId: id, reused, state: ctx.deploys.get(id) }, reused ? 200 : 202);
    } catch (error) {
      if (error instanceof DeployError) return c.json({ error: 'deploy_unconfigured', message: error.message }, 400);
      throw error;
    }
  });

  app.get('/deploy/:id', (c) => {
    const state = ctx.deploys.get(c.req.param('id'));
    if (!state) return c.json({ error: 'not_found', message: '未知的 deployId' }, 404);
    return c.json(state);
  });

  return app;
}