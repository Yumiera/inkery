/** 站内搜索：懒加载 search.json，多词 AND 匹配，标题 > 分类标签 > 摘要 > 正文 加权 */

interface SearchDoc {
  title: string;
  url: string;
  date: string;
  updated: string;
  tags: string[];
  categories: string[];
  excerpt: string;
  text: string;
}

interface Hit {
  doc: SearchDoc;
  weight: number;
}

const RESULT_LIMIT = 20;
const SNIPPET_BEFORE = 30;
const SNIPPET_AFTER = 70;

let cache: SearchDoc[] | null = null;
let inflight: Promise<SearchDoc[]> | null = null;

function loadIndex(url: string): Promise<SearchDoc[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch(url, { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : { docs: [] }))
    .then((data: { docs?: SearchDoc[] }) => {
      cache = Array.isArray(data.docs) ? data.docs : [];
      inflight = null;
      return cache;
    })
    .catch(() => {
      inflight = null;
      return [] as SearchDoc[];
    });
  return inflight;
}

function termsOf(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter((term) => term !== '');
}

function runSearch(docs: SearchDoc[], query: string): Hit[] {
  const terms = termsOf(query);
  if (terms.length === 0) {
    return docs.slice(0, RESULT_LIMIT).map((doc) => ({ doc, weight: 0 }));
  }

  const hits: Hit[] = [];
  for (const doc of docs) {
    const title = doc.title.toLowerCase();
    const taxonomy = [...doc.categories, ...doc.tags].join(' ').toLowerCase();
    const excerpt = doc.excerpt.toLowerCase();
    const body = doc.text.toLowerCase();

    let weight = 0;
    let matched = true;
    for (const term of terms) {
      if (title.includes(term)) weight += 100;
      else if (taxonomy.includes(term)) weight += 30;
      else if (excerpt.includes(term)) weight += 12;
      else if (body.includes(term)) weight += 4;
      else {
        matched = false;
        break;
      }
    }
    if (matched) hits.push({ doc, weight });
  }

  hits.sort((left, right) => right.weight - left.weight || right.doc.date.localeCompare(left.doc.date));
  return hits.slice(0, RESULT_LIMIT);
}

function snippetOf(doc: SearchDoc, query: string): string {
  const source = doc.text !== '' ? doc.text : doc.excerpt;
  const lower = source.toLowerCase();

  let at = -1;
  for (const term of termsOf(query)) {
    const found = lower.indexOf(term);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  if (at < 0) return source.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER);

  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(source.length, at + SNIPPET_AFTER);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

/** 命中词用 <mark> 包裹；全程走 textContent，不拼 HTML */
function highlighted(text: string, query: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const terms = termsOf(query);
  if (terms.length === 0) {
    fragment.append(text);
    return fragment;
  }

  const lower = text.toLowerCase();
  let cursor = 0;
  while (cursor < text.length) {
    let best = -1;
    let bestTerm = '';
    for (const term of terms) {
      const at = lower.indexOf(term, cursor);
      if (at >= 0 && (best < 0 || at < best)) {
        best = at;
        bestTerm = term;
      }
    }
    if (best < 0) break;
    if (best > cursor) fragment.append(text.slice(cursor, best));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(best, best + bestTerm.length);
    fragment.append(mark);
    cursor = best + bestTerm.length;
  }
  fragment.append(text.slice(cursor));
  return fragment;
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

export function initSearch(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-search-open]');
  const overlay = document.querySelector<HTMLElement>('[data-search-overlay]');
  if (!button || !overlay) return;

  const input = overlay.querySelector<HTMLInputElement>('[data-search-input]');
  const results = overlay.querySelector<HTMLElement>('[data-search-results]');
  const hint = overlay.querySelector<HTMLElement>('[data-search-hint]');
  if (!input || !results || !hint) return;

  const indexUrl = button.dataset.searchUrl ?? '/search.json';
  let docs: SearchDoc[] = [];
  let hits: Hit[] = [];
  let active = -1;
  let loading = false;

  const hintKeys = (): HTMLElement => {
    const keys = document.createElement('span');
    keys.className = 'search-hint-keys';
    for (const [index, label] of ['↑↓ 选择', 'Enter 打开', 'Esc 关闭'].entries()) {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.setAttribute('aria-hidden', 'true');
        keys.append(sep);
      }
      keys.append(label);
    }
    return keys;
  };

  const updateHint = (): void => {
    hint.textContent = '';
    let head: string;
    if (loading) head = '正在加载索引…';
    else if (docs.length === 0) head = '索引不可用';
    else if (input.value.trim() === '') head = `共 ${docs.length} 篇文章`;
    else if (hits.length === 0) head = `没有匹配「${input.value.trim()}」的文章`;
    else head = `找到 ${hits.length} 篇`;
    hint.append(head, hintKeys());
  };

  const setActive = (next: number): void => {
    if (hits.length === 0) return;
    active = (next + hits.length) % hits.length;
    const items = results.querySelectorAll<HTMLElement>('.search-result');
    items.forEach((item, index) => {
      const on = index === active;
      item.classList.toggle('is-active', on);
      item.setAttribute('aria-selected', String(on));
      if (on) item.scrollIntoView({ block: 'nearest' });
    });
  };

  const render = (): void => {
    hits = runSearch(docs, input.value);
    active = hits.length > 0 ? 0 : -1;
    results.textContent = '';

    if (hits.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'search-empty';
      empty.textContent =
        loading || docs.length === 0
          ? '正在加载索引…'
          : input.value.trim() === ''
            ? '还没有可搜索的文章'
            : '换个关键词试试';
      results.append(empty);
      updateHint();
      return;
    }

    const query = input.value;
    hits.forEach((hit, index) => {
      const link = document.createElement('a');
      link.className = 'search-result';
      link.href = hit.doc.url;
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', String(index === active));

      const title = document.createElement('span');
      title.className = 'search-result-title';
      title.append(highlighted(hit.doc.title, query));

      const snippet = document.createElement('span');
      snippet.className = 'search-result-snippet';
      snippet.append(highlighted(snippetOf(hit.doc, query), query));

      const meta = document.createElement('span');
      meta.className = 'search-result-meta';
      meta.textContent = [...hit.doc.categories, ...hit.doc.tags].join(' / ') || hit.doc.date;

      link.append(title, snippet, meta);
      results.append(link);
    });

    setActive(0);
    updateHint();
  };

  const open = (): void => {
    overlay.classList.add('is-open');
    document.body.classList.add('is-search-open');
    input.focus();
    input.select();

    if (docs.length === 0 && !loading) {
      loading = true;
      updateHint();
      void loadIndex(indexUrl).then((loaded) => {
        loading = false;
        docs = loaded;
        render();
      });
    }
  };

  const close = (): void => {
    overlay.classList.remove('is-open');
    document.body.classList.remove('is-search-open');
    button.focus();
  };

  button.addEventListener('click', open);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  input.addEventListener('input', render);

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(active - 1);
    } else if (event.key === 'Enter') {
      const target = results.querySelector<HTMLAnchorElement>('.search-result.is-active');
      if (target) {
        event.preventDefault();
        target.click();
      }
    }
  });

  window.addEventListener('keydown', (event) => {
    const isOpen = overlay.classList.contains('is-open');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (isOpen) close();
      else open();
      return;
    }
    if (isOpen) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      return;
    }
    if (event.key === '/' && !isEditable(event.target)) {
      event.preventDefault();
      open();
    }
  });
}
