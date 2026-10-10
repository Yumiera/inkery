import { useEffect, useRef, useState } from 'preact/hooks';
import { Link, useLocation } from 'wouter';
import {
  api,
  ApiError,
  type ConflictSnapshot,
  type PostDetail,
  type PostFrontmatter,
  type RenderResult,
} from '../api';
import { CodeEditor, type EditorApi } from '../components/CodeEditor';
import { Modal } from '../components/Modal';
import { TagInput } from '../components/TagInput';
import {
  colorPref,
  errorToast,
  meta,
  refreshPosts,
  resolvedMode,
  setColorPref,
  startBuild,
  toast,
} from '../store';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);
}

function metaLine(frontmatter: PostFrontmatter | null, result: RenderResult): string {
  const parts: string[] = [];
  if (frontmatter?.date) parts.push(escapeHtml(frontmatter.date));
  parts.push(`${result.wordCount} 字 · ${result.readingTime} 分钟`);
  for (const tag of frontmatter?.tags ?? []) parts.push(`#${escapeHtml(tag)}`);
  return parts.join(' · ');
}

const RENDER_DEBOUNCE_MS = 200;
const AUTOSAVE_INTERVAL_MS = 5000;

export function EditorPage({ slug }: { slug: string }) {
  const [, navigate] = useLocation();
  const editorRef = useRef<EditorApi | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameReady = useRef(false);
  const hashRef = useRef('');
  const dirtyRef = useRef(false);
  const fmRef = useRef<PostFrontmatter | null>(null);
  const detailRef = useRef<PostDetail | null>(null);
  const renderTimer = useRef<number | null>(null);

  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [frontmatter, setFrontmatter] = useState<PostFrontmatter | null>(null);
  const [conflict, setConflict] = useState<ConflictSnapshot | null>(null);
  const [autosave, setAutosave] = useState<{
    savedAt: number;
    body: string;
    frontmatter: PostFrontmatter;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const postToFrame = (message: unknown): void => {
    if (!frameReady.current) return;
    frameRef.current?.contentWindow?.postMessage(message, '*');
  };

  const doRender = async (): Promise<void> => {
    const editorApi = editorRef.current;
    if (!editorApi) return;
    const source = fmRef.current;
    try {
      const result = await api.render({
        markdown: editorApi.getDoc(),
        frontmatter: source ?? undefined,
        toc: source?.toc !== false,
      });
      postToFrame({
        type: 'render',
        html: result.html,
        title: source?.title ?? '',
        meta: metaLine(source, result),
      });
    } catch {
      /* 预览失败不打断编辑 */
    }
  };

  const scheduleRender = (): void => {
    if (renderTimer.current !== null) window.clearTimeout(renderTimer.current);
    renderTimer.current = window.setTimeout(() => {
      renderTimer.current = null;
      void doRender();
    }, RENDER_DEBOUNCE_MS);
  };

  const patch = (next: Partial<PostFrontmatter>): void => {
    const previous = fmRef.current;
    if (!previous) return;
    const merged = { ...previous, ...next };
    fmRef.current = merged;
    setFrontmatter(merged);
    dirtyRef.current = true;
    scheduleRender();
  };

  /* ---------- 载入 ---------- */

  useEffect(() => {
    let alive = true;
    setError(null);
    setStatusText('');
    setAutosave(null);
    dirtyRef.current = false;
    frameReady.current = false;

    void api
      .getPost(slug)
      .then(async (loaded) => {
        if (!alive) return;
        detailRef.current = loaded;
        hashRef.current = loaded.hash;
        fmRef.current = loaded.frontmatter;
        setDetail(loaded);
        setFrontmatter(loaded.frontmatter);
        editorRef.current?.setDoc(loaded.body);
        dirtyRef.current = false;

        const saved = await api.readAutosave(slug).catch(() => null);
        if (!alive || !saved?.exists || saved.savedAt === undefined) return;
        if ((saved.body ?? '') === loaded.body) {
          await api.clearAutosave(slug).catch(() => undefined);
          return;
        }
        setAutosave({
          savedAt: saved.savedAt,
          body: saved.body ?? '',
          frontmatter: saved.frontmatter ?? loaded.frontmatter,
        });
      })
      .catch((cause) => {
        if (!alive) return;
        setError(cause instanceof ApiError ? cause.message : String(cause));
      });

    return () => {
      alive = false;
    };
  }, [slug]);

  /* ---------- 预览壳通信 ---------- */

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (!data || data.type !== 'shell-ready') return;
      frameReady.current = true;
      frameRef.current?.contentWindow?.postMessage({ type: 'colorMode', mode: colorPref.value }, '*');
      void doRender();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (frameReady.current) {
      frameRef.current?.contentWindow?.postMessage({ type: 'colorMode', mode: colorPref.value }, '*');
    }
  }, [colorPref.value]);

  useEffect(() => {
    if (detail !== null && frameReady.current) void doRender();
  }, [detail]);

  useEffect(
    () => () => {
      if (renderTimer.current !== null) window.clearTimeout(renderTimer.current);
    },
    [],
  );

  /* ---------- 保存 ---------- */

  const collectFrontmatter = (): Record<string, unknown> => {
    const source = fmRef.current;
    if (!source) return {};
    const out: Record<string, unknown> = { title: source.title, date: source.date };
    if (source.tags && source.tags.length > 0) out.tags = source.tags;
    if (source.categories && source.categories.length > 0) out.categories = source.categories;
    if (source.cover) out.cover = source.cover;
    if (source.coverAlt) out.coverAlt = source.coverAlt;
    if (source.excerpt) out.excerpt = source.excerpt;
    if (source.pinned) out.pinned = true;
    if (source.toc === false) out.toc = false;
    return out;
  };

  const adopt = (next: PostDetail): void => {
    detailRef.current = next;
    hashRef.current = next.hash;
    fmRef.current = next.frontmatter;
    setDetail(next);
    setFrontmatter(next.frontmatter);
  };

  const save = async (options: { publishDraft?: boolean; build?: boolean } = {}): Promise<void> => {
    const editorApi = editorRef.current;
    if (!editorApi || fmRef.current === null) return;

    setSaving(true);
    setStatusText('保存中…');
    try {
      let current = await api.savePost(slug, {
        frontmatter: collectFrontmatter(),
        body: editorApi.getDoc(),
        hash: hashRef.current,
      });
      dirtyRef.current = false;
      await api.clearAutosave(slug).catch(() => undefined);
      setAutosave(null);

      const desired = fmRef.current.slug.trim().toLowerCase();
      if (desired !== '' && desired !== current.slug) {
        current = await api.renamePost(current.slug, desired);
      }
      if (options.publishDraft === true && current.kind === 'draft') {
        current = await api.setPostState(current.slug, 'published');
      }

      adopt(current);
      dirtyRef.current = false;
      setStatusText(`已保存 ${new Date().toLocaleTimeString()}`);
      await refreshPosts();

      if (options.build === true) {
        await startBuild({});
        toast('已保存并触发构建', 'success');
      } else {
        toast('已保存', 'success');
      }
      if (current.slug !== slug) navigate(`/edit/${current.slug}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && cause.body?.current) {
        setConflict(cause.body.current);
        setStatusText('检测到磁盘冲突');
      } else {
        errorToast(cause);
        setStatusText('保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* ---------- 自动存档 ---------- */

  useEffect(() => {
    const timer = window.setInterval(() => {
      const editorApi = editorRef.current;
      const source = fmRef.current;
      if (!editorApi || !source || !dirtyRef.current) return;
      void api
        .writeAutosave(slug, { body: editorApi.getDoc(), frontmatter: source })
        .catch(() => undefined);
    }, AUTOSAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [slug]);

  /* ---------- 图片上传 ---------- */

  const uploadFiles = async (files: File[]): Promise<void> => {
    const editorApi = editorRef.current;
    const currentSlug = detailRef.current?.slug ?? slug;
    if (!editorApi || currentSlug === '') return;
    for (const file of files) {
      const edited = editorApi.insert('\n![上传中…]()\n');
      try {
        const result = await api.uploadMedia(file, currentSlug);
        editorApi.replace(edited.from, edited.to, `\n![](./${result.name})\n`);
        dirtyRef.current = true;
        scheduleRender();
        toast(
          `已插入 ${result.name}`,
          'success',
          result.width !== null && result.height !== null ? `${result.width}×${result.height}` : undefined,
        );
      } catch (cause) {
        editorApi.replace(edited.from, edited.to, '');
        errorToast(cause);
      }
    }
  };

  /* ---------- 冲突处理 ---------- */

  const reloadFromDisk = async (): Promise<void> => {
    setConflict(null);
    try {
      const loaded = await api.getPost(slug);
      adopt(loaded);
      editorRef.current?.setDoc(loaded.body);
      dirtyRef.current = false;
      setStatusText('已载入磁盘版本');
      scheduleRender();
    } catch (cause) {
      errorToast(cause);
    }
  };

  const overwrite = async (): Promise<void> => {
    const snapshot = conflict;
    setConflict(null);
    if (!snapshot || !editorRef.current) return;
    setSaving(true);
    try {
      const saved = await api.savePost(slug, {
        frontmatter: collectFrontmatter(),
        body: editorRef.current.getDoc(),
        hash: snapshot.hash,
      });
      adopt(saved);
      dirtyRef.current = false;
      await api.clearAutosave(slug).catch(() => undefined);
      setStatusText('已用本地版本覆盖');
      toast('已覆盖磁盘版本', 'success');
      await refreshPosts();
    } catch (cause) {
      errorToast(cause);
    } finally {
      setSaving(false);
    }
  };

  const restoreAutosave = (): void => {
    if (!autosave) return;
    fmRef.current = autosave.frontmatter;
    setFrontmatter(autosave.frontmatter);
    editorRef.current?.setDoc(autosave.body);
    dirtyRef.current = true;
    setAutosave(null);
    setStatusText('已恢复自动存档');
    scheduleRender();
  };

  const discardAutosave = (): void => {
    setAutosave(null);
    void api.clearAutosave(slug).catch(() => undefined);
  };

  const siteBase = meta.value?.siteUrl ?? '';
  const dark = resolvedMode.value === 'dark';
  const toolButtons: { label: string; title: string; run: () => void }[] = [
    { label: 'B', title: '粗体', run: () => editorRef.current?.wrap('**', '**', '粗体') },
    { label: 'I', title: '斜体', run: () => editorRef.current?.wrap('*', '*', '斜体') },
    { label: '`x`', title: '行内代码', run: () => editorRef.current?.wrap('`', '`', 'code') },
    { label: 'H2', title: '二级标题', run: () => editorRef.current?.insertBlock('## 标题') },
    { label: '>', title: '引用', run: () => editorRef.current?.insertBlock('> 引用内容') },
    { label: '链接', title: '链接', run: () => editorRef.current?.wrap('[', '](https://)', '链接文本') },
    { label: '图片', title: '图片', run: () => editorRef.current?.insert('![描述](./image.png)') },
    {
      label: '代码块',
      title: '代码块',
      run: () => editorRef.current?.insertBlock('```ts\ncode\n```'),
    },
    {
      label: '表格',
      title: '表格',
      run: () =>
        editorRef.current?.insertBlock('| 列 A | 列 B |\n| --- | --- |\n| 1 | 2 |'),
    },
    { label: '公式', title: '块级公式', run: () => editorRef.current?.insertBlock('$$\nE = mc^2\n$$') },
  ];

  return (
    <div class="editor">
      <div class="editor-head">
        <Link class="btn btn-ghost btn-sm" href="/">
          ← 列表
        </Link>
        <input
          class="title"
          placeholder="标题"
          value={frontmatter?.title ?? ''}
          onInput={(event) => patch({ title: event.currentTarget.value })}
        />
        {detail ? (
          <span class={`badge badge-${detail.state}`}>
            {detail.state === 'draft' ? '草稿' : detail.state === 'scheduled' ? '定时' : '已发布'}
          </span>
        ) : null}
        <span class="muted">{statusText}</span>
        <span class="spacer" />
        <button
          class="btn btn-sm"
          disabled={saving || frontmatter === null}
          onClick={() => void save()}
          title="Ctrl+S"
        >
          保存
        </button>
        <button
          class="btn btn-primary btn-sm"
          disabled={saving || frontmatter === null}
          onClick={() => void save({ publishDraft: true, build: true })}
          title="保存，草稿将转为已发布，然后触发构建"
        >
          {saving ? '处理中…' : '保存并构建'}
        </button>
      </div>

      {error !== null ? (
        <div class="banner">
          <span>加载失败：{error}</span>
          <Link class="btn btn-sm" href="/">
            返回列表
          </Link>
        </div>
      ) : null}

      {autosave !== null ? (
        <div class="banner">
          <span>
            检测到自动存档（{new Date(autosave.savedAt).toLocaleString()}），与磁盘版本不同。
          </span>
          <span class="spacer" />
          <button class="btn btn-sm" onClick={restoreAutosave}>
            恢复
          </button>
          <button class="btn btn-ghost btn-sm" onClick={discardAutosave}>
            忽略
          </button>
        </div>
      ) : null}

      {frontmatter !== null ? (
        <div class="fm-grid">
          <div class="fm-field">
            <label>slug</label>
            <input value={frontmatter.slug} onInput={(event) => patch({ slug: event.currentTarget.value })} />
          </div>
          <div class="fm-field">
            <label>日期（站点时区）</label>
            <input value={frontmatter.date} onInput={(event) => patch({ date: event.currentTarget.value })} />
          </div>
          <div class="fm-field">
            <label>标签</label>
            <TagInput value={frontmatter.tags ?? []} onChange={(tags) => patch({ tags })} placeholder="回车添加" />
          </div>
          <div class="fm-field">
            <label>分类</label>
            <TagInput
              value={frontmatter.categories ?? []}
              onChange={(categories) => patch({ categories })}
              placeholder="回车添加"
            />
          </div>
          <div class="fm-field">
            <label>封面</label>
            <input
              value={frontmatter.cover ?? ''}
              placeholder="/posts/slug/cover.png"
              onInput={(event) => patch({ cover: event.currentTarget.value })}
            />
          </div>
          <div class="fm-field wide">
            <label>摘要</label>
            <input
              value={frontmatter.excerpt ?? ''}
              onInput={(event) => patch({ excerpt: event.currentTarget.value })}
            />
          </div>
          <div class="fm-field fm-check">
            <input
              type="checkbox"
              checked={frontmatter.pinned === true}
              onChange={(event) => patch({ pinned: event.currentTarget.checked })}
            />
            <label>置顶</label>
          </div>
          <div class="fm-field fm-check">
            <input
              type="checkbox"
              checked={frontmatter.toc !== false}
              onChange={(event) => patch({ toc: event.currentTarget.checked })}
            />
            <label>目录</label>
          </div>
        </div>
      ) : null}

      <div class="toolbar">
        {toolButtons.map((item) => (
          <button key={item.label} title={item.title} onClick={item.run}>
            {item.label}
          </button>
        ))}
        <span class="spacer" />
        <span class="muted">
          {detail ? (
            <>
              {detail.wordCount} 字{' '}
              <span class="sep" aria-hidden="true" />{' '}
              {detail.readingTime} 分钟
            </>
          ) : (
            ''
          )}
        </span>
      </div>

      <div class="split">
        <div class="pane">
          <div class="pane-head">
            <span>Markdown</span>
            <span class="muted">支持粘贴 / 拖拽图片上传</span>
          </div>
          <CodeEditor
            initialValue=""
            apiRef={editorRef}
            dark={dark}
            onChange={() => {
              dirtyRef.current = true;
              scheduleRender();
            }}
            onCursorLine={(line) => postToFrame({ type: 'scrollToLine', line })}
            onDropFiles={(files) => void uploadFiles(files)}
          />
        </div>
        <div class="pane">
          <div class="pane-head">
            <span>预览</span>
            <button class="btn btn-ghost btn-sm" onClick={() => void doRender()}>
              重新渲染
            </button>
            <span class="spacer" />
            <select
              value={colorPref.value}
              onChange={(event) =>
                setColorPref(event.currentTarget.value as 'auto' | 'light' | 'dark')
              }
            >
              <option value="auto">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
            {detail ? (
              <a class="btn btn-ghost btn-sm" href={`${siteBase}${detail.url}`} target="_blank" rel="noreferrer">
                打开
              </a>
            ) : null}
          </div>
          <iframe class="preview-frame" ref={frameRef} src="/api/preview/shell" title="预览" />
        </div>
      </div>

      {conflict !== null ? (
        <Modal
          title="磁盘上的文件已被外部修改"
          onClose={() => setConflict(null)}
          actions={
            <>
              <button class="btn" onClick={() => void reloadFromDisk()}>
                载入磁盘版本
              </button>
              <button class="btn btn-primary" disabled={saving} onClick={() => void overwrite()}>
                用我的版本覆盖
              </button>
            </>
          }
        >
          <p>保存前检测到 hash 不一致。选择一项继续：</p>
        </Modal>
      ) : null}
    </div>
  );
}