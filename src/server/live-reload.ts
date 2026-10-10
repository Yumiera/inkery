import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

/** 构建快照：既是 GET /api/build/:id 的响应体，也是 SSE build 事件的载荷 */
export interface BuildStatePayload {
  id: string;
  status: 'running' | 'done' | 'error';
  phase: string;
  current: number;
  total: number;
  message: string;
  changedUrls: string[];
  errors: string[];
  startedAt: number;
  finishedAt: number | null;
}

/** 部署快照：既是 GET /api/deploy/:id 的响应体，也是 SSE deploy 事件的载荷 */
export interface DeployStatePayload {
  id: string;
  status: 'running' | 'done' | 'error';
  phase: string;
  message: string;
  buildId: string | null;
  committed: boolean | null;
  log: string[];
  errors: string[];
  startedAt: number;
  finishedAt: number | null;
}

export type ServerEvent =
  | { type: 'reload'; urls: string[] }
  | { type: 'build'; state: BuildStatePayload }
  | { type: 'deploy'; state: DeployStatePayload };

interface Client {
  write(event: ServerEvent): void;
  close(): void;
}

const HEARTBEAT_MS = 25_000;

/** SSE 广播中心：预览页与后台构建面板共用一条 /api/livereload 通道 */
export class LiveReloadHub {
  private readonly clients = new Set<Client>();

  get size(): number {
    return this.clients.size;
  }

  handler = (c: Context): Response | Promise<Response> => {
    return streamSSE(c, async (stream) => {
      let closed = false;
      const client: Client = {
        write: (event) => {
          if (closed) return;
          void stream.writeSSE({ data: JSON.stringify(event) }).catch(() => undefined);
        },
        close: () => {
          closed = true;
        },
      };

      this.clients.add(client);
      const timer = setInterval(() => {
        if (closed) return;
        void stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => undefined);
      }, HEARTBEAT_MS);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });

      clearInterval(timer);
      closed = true;
      this.clients.delete(client);
    });
  };

  broadcast(event: ServerEvent): void {
    for (const client of [...this.clients]) client.write(event);
  }

  closeAll(): void {
    for (const client of [...this.clients]) client.close();
    this.clients.clear();
  }
}