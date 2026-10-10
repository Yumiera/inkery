import { computed, signal } from '@preact/signals';
import {
  api,
  ApiError,
  type BuildStatePayload,
  type DeployStatePayload,
  type MetaPayload,
  type PostSummary,
} from './api';

/* ---------- Toast ---------- */

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
}

export const toasts = signal<Toast[]>([]);
let toastSeq = 0;

export function toast(message: string, kind: ToastKind = 'info', detail?: string): number {
  const id = ++toastSeq;
  toasts.value = [...toasts.value, { id, kind, message, detail }];
  window.setTimeout(() => dismissToast(id), kind === 'error' ? 6000 : 3000);
  return id;
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((item) => item.id !== id);
}

export function errorToast(error: unknown): void {
  if (error instanceof ApiError) {
    const first = error.issues[0];
    toast(error.message, 'error', first ? `${first.field ?? ''} ${first.message}`.trim() : undefined);
    return;
  }
  toast(error instanceof Error ? error.message : String(error), 'error');
}

/* ---------- 主题 ---------- */

export type ColorPref = 'auto' | 'light' | 'dark';

const MODE_KEY = 'inkery-admin-mode';

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(pref: ColorPref): 'light' | 'dark' {
  if (pref === 'auto') return prefersDark() ? 'dark' : 'light';
  return pref;
}

function initialPref(): ColorPref {
  const stored = localStorage.getItem(MODE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'auto' ? stored : 'auto';
}

export const colorPref = signal<ColorPref>(initialPref());
export const resolvedMode = signal<'light' | 'dark'>(resolve(colorPref.value));
document.documentElement.dataset.theme = resolvedMode.value;

export function setColorPref(pref: ColorPref): void {
  colorPref.value = pref;
  try {
    localStorage.setItem(MODE_KEY, pref);
  } catch {
    /* 隐私模式下忽略 */
  }
  const next = resolve(pref);
  resolvedMode.value = next;
  document.documentElement.dataset.theme = next;
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (colorPref.value !== 'auto') return;
  const next = resolve('auto');
  resolvedMode.value = next;
  document.documentElement.dataset.theme = next;
});

/* ---------- 文章集合 ---------- */

export const posts = signal<PostSummary[]>([]);
export const postsLoading = signal(false);
export const postsLoaded = signal(false);

export const overview = computed(() => {
  const all = posts.value;
  let drafts = 0;
  let scheduled = 0;
  let published = 0;
  for (const post of all) {
    if (post.state === 'draft') drafts += 1;
    else if (post.state === 'scheduled') scheduled += 1;
    else published += 1;
  }
  const latest = all.reduce<PostSummary | null>((best, post) => {
    if (!best) return post;
    return (post.updated ?? post.date) > (best.updated ?? best.date) ? post : best;
  }, null);
  return { total: all.length, drafts, scheduled, published, latest };
});

export async function refreshPosts(): Promise<void> {
  postsLoading.value = true;
  try {
    const result = await api.listPosts({ status: 'all', sort: '-updated', pageSize: 200 });
    posts.value = result.items;
    postsLoaded.value = true;
  } catch (error) {
    errorToast(error);
  } finally {
    postsLoading.value = false;
  }
}

/* ---------- 站点元信息与构建 ---------- */

export const meta = signal<MetaPayload | null>(null);
export const buildState = signal<BuildStatePayload | null>(null);
export const deployState = signal<DeployStatePayload | null>(null);
export const changedUrls = signal<string[]>([]);
export const liveConnected = signal(false);

export async function refreshMeta(): Promise<void> {
  try {
    const payload = await api.meta();
    meta.value = payload;
    if (deployState.value === null && payload.lastDeploy) deployState.value = payload.lastDeploy;
  } catch {
    /* 元信息失败不阻塞界面 */
  }
}

function applyBuild(state: BuildStatePayload): void {
  buildState.value = state;
  if (state.status === 'done') {
    changedUrls.value = state.changedUrls;
    void refreshPosts();
  }
}

export async function startBuild(options: { clean?: boolean; drafts?: boolean } = {}): Promise<void> {
  try {
    const { buildId, state } = await api.startBuild(options);
    if (state) applyBuild(state);
    else {
      const latest = await api.getBuild(buildId).catch(() => null);
      if (latest) applyBuild(latest);
    }
  } catch (error) {
    errorToast(error);
  }
}

let notifiedDeploy = '';

function applyDeploy(state: DeployStatePayload): void {
  deployState.value = state;
  if (state.status === 'running' || notifiedDeploy === state.id) return;
  notifiedDeploy = state.id;
  if (state.status === 'done') {
    toast(state.message, 'success');
    void refreshMeta();
  } else {
    toast('部署失败', 'error', state.errors[0]);
  }
}

export async function startDeploy(options: { skipBuild?: boolean } = {}): Promise<void> {
  try {
    const { deployId, state } = await api.startDeploy(options);
    if (state) applyDeploy(state);
    else {
      const latest = await api.getDeploy(deployId).catch(() => null);
      if (latest) applyDeploy(latest);
    }
  } catch (error) {
    errorToast(error);
  }
}

/** 订阅 SSE：构建 / 部署进度与构建完成后的 URL 变化 */
export function connectLiveReload(): () => void {
  const source = new EventSource('/api/livereload');

  source.onopen = () => {
    liveConnected.value = true;
  };
  source.onerror = () => {
    liveConnected.value = false;
  };
  source.onmessage = (event) => {
    let payload: {
      type?: string;
      state?: BuildStatePayload | DeployStatePayload;
      urls?: string[];
    };
    try {
      payload = JSON.parse(event.data) as typeof payload;
    } catch {
      return;
    }
    if (payload.type === 'build' && payload.state) applyBuild(payload.state as BuildStatePayload);
    else if (payload.type === 'deploy' && payload.state) applyDeploy(payload.state as DeployStatePayload);
    else if (payload.type === 'reload' && payload.urls) changedUrls.value = payload.urls;
  };

  return () => source.close();
}