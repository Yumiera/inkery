/** 后台 ↔ 服务端 API 客户端：令牌取自 cookie，统一错误包装 */

export const TOKEN_COOKIE = 'blog_token';

export type PostState = 'draft' | 'published' | 'scheduled';
export type PostKind = 'post' | 'draft';

export interface PostFrontmatter {
  title: string;
  slug: string;
  date: string;
  updated?: string;
  tags?: string[];
  categories?: string[];
  cover?: string;
  coverAlt?: string;
  excerpt?: string;
  description?: string;
  keywords?: string[];
  author?: string;
  lang?: string;
  pinned?: boolean;
  toc?: boolean;
  math?: boolean | 'auto';
  comments?: boolean;
  hidden?: boolean;
  aliases?: string[];
  series?: string;
}

export interface PostSummary {
  slug: string;
  title: string;
  date: string;
  updated?: string;
  tags: string[];
  categories: string[];
  cover: string;
  excerpt: string;
  state: PostState;
  kind: PostKind;
  url: string;
  wordCount: number;
  readingTime: number;
  pinned: boolean;
  hidden: boolean;
  hash: string;
}

export interface PostDetail {
  slug: string;
  kind: PostKind;
  relDir: string;
  state: PostState;
  url: string;
  hash: string;
  wordCount: number;
  readingTime: number;
  assets: string[];
  frontmatter: PostFrontmatter;
  body: string;
  raw: string;
}

export interface PostListResult {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  items: PostSummary[];
}

export interface MediaUploadResult {
  relPath: string;
  url: string;
  size: number;
  width: number | null;
  height: number | null;
  name: string;
}

export interface RenderResult {
  html: string;
  toc: unknown;
  headings: { level: number; text: string; id: string }[];
  excerpt: string;
  wordCount: number;
  readingTime: number;
  images: unknown;
  warnings: string[];
  cached: boolean;
  elapsed: number;
}

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

export interface DeployTarget {
  configured: boolean;
  enabled: boolean;
  type: string;
  repo: string;
  branch: string;
  cname: string;
  pagesUrl: string | null;
  reason: string;
  warnings: string[];
}

export interface MetaPayload {
  version: string;
  mode: 'dev' | 'prod';
  buildState: string;
  deploy: DeployTarget;
  deployState: string;
  siteUrl: string;
  liveReloadClients: number;
  lastBuild: BuildStatePayload | null;
  lastDeploy: DeployStatePayload | null;
}

export interface SiteSettings {
  title: string;
  subtitle: string;
  description: string;
  keywords: string[];
  author: string;
  email: string;
  lang: string;
  timezone: string;
  url: string;
  baseUrl: string;
  verify: {
    google: string;
    bing: string;
    baidu: string;
    yandex: string;
  };
}

export interface DeploySettings {
  enabled: boolean;
  repo: string;
  branch: string;
  forcePush: boolean;
  message: string;
  cname: string;
}

export interface ConfigPayload {
  site: SiteSettings;
  deploy: DeploySettings;
  configFile: string;
  preview: {
    deployable: boolean;
    pagesUrl: string | null;
    reason: string;
    warnings: string[];
  };
}

export interface SaveConfigResult extends ConfigPayload {
  ok: true;
  reused: boolean;
  buildId: string;
}

export interface VerifyFile {
  name: string;
  size: number;
  mtimeMs: number;
}

export interface VerifyFilesResult {
  dir: string;
  items: VerifyFile[];
}

export interface ConflictSnapshot {
  hash: string;
  raw: string;
  frontmatter: PostFrontmatter;
  body: string;
}

interface ApiErrorBody {
  error?: string;
  message?: string;
  issues?: { field?: string; message: string }[];
  current?: ConflictSnapshot;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody | null,
  ) {
    super(body?.message ?? `请求失败（HTTP ${status}）`);
    this.name = 'ApiError';
  }

  get issues(): { field?: string; message: string }[] {
    return this.body?.issues ?? [];
  }
}

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : '';
}

export function token(): string {
  return readCookie(TOKEN_COOKIE);
}

/** 首次进入必须先请求 /api/meta（免令牌），由它下发 blog_token cookie */
export async function bootstrapToken(): Promise<void> {
  if (readCookie(TOKEN_COOKIE) !== '') return;
  await fetch('/api/meta', { credentials: 'same-origin' }).catch(() => undefined);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const current = readCookie(TOKEN_COOKIE);
  if (current !== '') headers.set('X-Blog-Token', current);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');

  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const text = await res.text();
  let data: unknown = null;
  if (text !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) throw new ApiError(res.status, (data ?? null) as ApiErrorBody | null);
  return data as T;
}

function json(method: string, body?: unknown): RequestInit {
  return { method, body: body === undefined ? undefined : JSON.stringify(body) };
}

export const api = {
  meta: () => request<MetaPayload>('/api/meta'),

  listPosts(params: {
    status?: string;
    q?: string;
    tag?: string;
    category?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PostListResult> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value));
    }
    const suffix = query.toString();
    return request<PostListResult>(`/api/posts${suffix === '' ? '' : `?${suffix}`}`);
  },

  getPost: (slug: string) => request<PostDetail>(`/api/posts/${encodeURIComponent(slug)}`),

  createPost: (input: {
    title: string;
    slug?: string;
    date?: string;
    tags?: string[];
    categories?: string[];
    body?: string;
    kind?: PostKind;
  }) => request<PostDetail>('/api/posts', json('POST', input)),

  savePost: (slug: string, input: { frontmatter: object; body: string; hash?: string }) =>
    request<PostDetail>(`/api/posts/${encodeURIComponent(slug)}`, json('PUT', input)),

  setPostState: (slug: string, state: PostState) =>
    request<PostDetail>(`/api/posts/${encodeURIComponent(slug)}/state`, json('PATCH', { state })),

  renamePost: (slug: string, nextSlug: string) =>
    request<PostDetail>(`/api/posts/${encodeURIComponent(slug)}/rename`, json('POST', { slug: nextSlug })),

  deletePost: (slug: string, hard = false) =>
    request<{ slug: string; trash: string }>(
      `/api/posts/${encodeURIComponent(slug)}${hard ? '?hard=1' : ''}`,
      json('DELETE'),
    ),

  render: (input: { markdown: string; frontmatter?: object; toc?: boolean }) =>
    request<RenderResult>('/api/render', json('POST', input)),

  uploadMedia: (file: File, slug: string, scope: 'post' | 'global' = 'post') => {
    const form = new FormData();
    form.set('file', file, file.name || 'image.png');
    form.set('scope', scope);
    form.set('slug', slug);
    return request<MediaUploadResult>('/api/media', { method: 'POST', body: form });
  },

  startBuild: (input: { clean?: boolean; drafts?: boolean } = {}) =>
    request<{ buildId: string; reused: boolean; state: BuildStatePayload | null }>(
      '/api/build',
      json('POST', input),
    ),

  getBuild: (id: string) => request<BuildStatePayload>(`/api/build/${encodeURIComponent(id)}`),

  startDeploy: (input: { skipBuild?: boolean } = {}) =>
    request<{ deployId: string; reused: boolean; state: DeployStatePayload | null }>(
      '/api/deploy',
      json('POST', input),
    ),

  getDeploy: (id: string) =>
    request<DeployStatePayload>(`/api/deploy/${encodeURIComponent(id)}`),

  getConfig: () => request<ConfigPayload>('/api/config'),

  saveConfig: (patch: { site?: Partial<SiteSettings>; deploy?: Partial<DeploySettings> }) =>
    request<SaveConfigResult>('/api/config', json('PUT', patch)),

  listVerifyFiles: () => request<VerifyFilesResult>('/api/verify/files'),

  uploadVerifyFile: (file: File) => {
    const form = new FormData();
    form.set('file', file, file.name);
    return request<VerifyFilesResult & { ok: true }>('/api/verify/files', { method: 'POST', body: form });
  },

  deleteVerifyFile: (name: string) =>
    request<VerifyFilesResult & { ok: true }>(`/api/verify/files/${encodeURIComponent(name)}`, json('DELETE')),

  readAutosave: (slug: string) =>
    request<{ exists: boolean; savedAt?: number; body?: string; frontmatter?: PostFrontmatter }>(
      `/api/autosave/${encodeURIComponent(slug)}`,
    ),

  writeAutosave: (slug: string, input: { body: string; frontmatter: PostFrontmatter }) =>
    request<{ ok: true; savedAt: number }>(
      `/api/autosave/${encodeURIComponent(slug)}`,
      json('PUT', input),
    ),

  clearAutosave: (slug: string) =>
    request<{ ok: true }>(`/api/autosave/${encodeURIComponent(slug)}`, json('DELETE')),
};