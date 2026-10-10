import { useMemo, useState } from 'preact/hooks';
import { Link, useLocation } from 'wouter';
import { api, type PostState, type PostSummary } from '../api';
import { Modal } from '../components/Modal';
import { errorToast, meta, overview, posts, postsLoading, refreshPosts, toast } from '../store';

const SORTS: { value: string; label: string }[] = [
  { value: '-updated', label: '最近更新' },
  { value: '-date', label: '发布日期' },
  { value: 'title', label: '标题' },
  { value: '-wordCount', label: '字数' },
];

const STATE_LABEL: Record<PostState, string> = {
  draft: '草稿',
  published: '已发布',
  scheduled: '定时',
};

function sortValue(post: PostSummary, key: string): string | number {
  switch (key) {
    case 'title':
      return post.title.toLowerCase();
    case 'wordCount':
      return post.wordCount;
    case 'date':
      return post.date;
    default:
      return post.updated ?? post.date;
  }
}

export function ListPage() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<'all' | PostState>('all');
  const [tag, setTag] = useState('all');
  const [sort, setSort] = useState('-updated');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<'post' | 'draft'>('draft');
  const [deleteTarget, setDeleteTarget] = useState<PostSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const post of posts.value) for (const item of post.tags) set.add(item);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [posts.value]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const desc = sort.startsWith('-');
    const key = desc ? sort.slice(1) : sort;

    const filtered = posts.value.filter((post) => {
      if (status !== 'all' && post.state !== status) return false;
      if (tag !== 'all' && !post.tags.includes(tag)) return false;
      if (needle !== '') {
        const haystack = [post.title, post.slug, ...post.tags, ...post.categories]
          .join('\n')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      const left = sortValue(a, key);
      const right = sortValue(b, key);
      let result: number;
      if (typeof left === 'number' && typeof right === 'number') result = left - right;
      else result = String(left).localeCompare(String(right));
      if (result === 0) result = a.slug.localeCompare(b.slug);
      return desc ? -result : result;
    });
  }, [posts.value, status, tag, sort, query]);

  const siteBase = meta.value?.siteUrl ?? '';

  const submitCreate = async (): Promise<void> => {
    const title = newTitle.trim();
    if (title === '') return;
    setBusy(true);
    try {
      const detail = await api.createPost({ title, kind: newKind });
      await refreshPosts();
      setCreating(false);
      setNewTitle('');
      navigate(`/edit/${detail.slug}`);
    } catch (error) {
      errorToast(error);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const result = await api.deletePost(deleteTarget.slug);
      toast(`已删除「${deleteTarget.title}」`, 'success', result.trash ? `移入 ${result.trash}` : undefined);
      setDeleteTarget(null);
      await refreshPosts();
    } catch (error) {
      errorToast(error);
    } finally {
      setBusy(false);
    }
  };

  const copySlug = (slug: string): void => {
    void navigator.clipboard
      .writeText(slug)
      .then(() => toast(`已复制 ${slug}`, 'success'))
      .catch(() => toast('复制失败，请手动选择', 'error'));
  };

  return (
    <>
      <div class="page-head">
        <h1>文章</h1>
        <span class="muted">
          共 {overview.value.total} 篇{' '}
          <span class="sep" aria-hidden="true" />{' '}
          草稿 {overview.value.drafts}
        </span>
        <span class="spacer" />
        <button class="btn btn-sm" onClick={() => void refreshPosts()} disabled={postsLoading.value}>
          {postsLoading.value ? '刷新中…' : '刷新'}
        </button>
        <button class="btn btn-primary" onClick={() => setCreating(true)}>
          新建文章
        </button>
      </div>

      <div class="filters">
        <select value={status} onChange={(event) => setStatus(event.currentTarget.value as 'all' | PostState)}>
          <option value="all">全部状态</option>
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
          <option value="scheduled">定时</option>
        </select>
        <select value={tag} onChange={(event) => setTag(event.currentTarget.value)}>
          <option value="all">全部标签</option>
          {allTags.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(event) => setSort(event.currentTarget.value)}>
          {SORTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <input
          placeholder="搜索标题 / slug / 标签"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <span class="muted">{rows.length} 条</span>
      </div>

      <table class="table">
        <thead>
          <tr>
            <th>封面</th>
            <th>标题</th>
            <th>状态</th>
            <th>标签</th>
            <th>分类</th>
            <th>字数</th>
            <th>时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((post) => (
            <tr key={`${post.kind}/${post.slug}`}>
              <td>
                {post.cover ? <img class="thumb" src={`${siteBase}${post.cover}`} alt="" /> : <div class="thumb" />}
              </td>
              <td>
                <div class="cell-title">
                  <Link href={`/edit/${post.slug}`}>{post.title || '(无标题)'}</Link>
                  {post.pinned ? <span class="badge badge-scheduled">置顶</span> : null}
                </div>
                <div class="mono">{post.slug}</div>
              </td>
              <td>
                <span class={`badge badge-${post.state}`}>{STATE_LABEL[post.state]}</span>
              </td>
              <td>
                {post.tags.slice(0, 3).map((item) => (
                  <span class="badge badge-tag" key={item}>
                    {item}
                  </span>
                ))}
                {post.tags.length > 3 ? <span class="muted">+{post.tags.length - 3}</span> : null}
              </td>
              <td class="muted">{post.categories.join(' / ')}</td>
              <td class="muted">
                {post.wordCount} 字{' '}
                <span class="sep" aria-hidden="true" />{' '}
                {post.readingTime} 分
              </td>
              <td class="muted">{post.updated ?? post.date}</td>
              <td>
                <div class="cell-actions" style={{ display: 'flex', gap: '4px' }}>
                  <button class="btn btn-ghost btn-sm" onClick={() => copySlug(post.slug)}>
                    复制
                  </button>
                  <a class="btn btn-ghost btn-sm" href={`${siteBase}${post.url}`} target="_blank" rel="noreferrer">
                    预览
                  </a>
                  <button class="btn btn-ghost btn-sm btn-danger" onClick={() => setDeleteTarget(post)}>
                    删除
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 ? (
        <div class="empty">{postsLoading.value ? '加载中…' : '没有匹配的文章'}</div>
      ) : null}

      {creating ? (
        <Modal
          title="新建文章"
          onClose={() => setCreating(false)}
          actions={
            <>
              <button class="btn" onClick={() => setCreating(false)}>
                取消
              </button>
              <button class="btn btn-primary" disabled={busy || newTitle.trim() === ''} onClick={() => void submitCreate()}>
                {busy ? '创建中…' : '创建并编辑'}
              </button>
            </>
          }
        >
          <div class="field">
            <label>标题</label>
            <input
              autoFocus
              value={newTitle}
              onInput={(event) => setNewTitle(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitCreate();
              }}
            />
          </div>
          <div class="field">
            <label>类型</label>
            <select value={newKind} onChange={(event) => setNewKind(event.currentTarget.value as 'post' | 'draft')}>
              <option value="draft">草稿（content/drafts）</option>
              <option value="post">正式文章（content/posts）</option>
            </select>
          </div>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal
          title="删除文章"
          onClose={() => setDeleteTarget(null)}
          actions={
            <>
              <button class="btn" onClick={() => setDeleteTarget(null)}>
                取消
              </button>
              <button class="btn btn-danger" disabled={busy} onClick={() => void confirmDelete()}>
                {busy ? '删除中…' : '移入回收站'}
              </button>
            </>
          }
        >
          <p>
            将把「{deleteTarget.title}」移动到 <code>.cache/trash/</code>，可手动恢复。
          </p>
        </Modal>
      ) : null}
    </>
  );
}