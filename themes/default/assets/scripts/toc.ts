/** 目录滚动高亮：body 内标题 vs [data-toc-link] */

function headerOffset(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--header-height');
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value + 16 : 76;
}

export function initTocScrollSpy(): void {
  const links = document.querySelectorAll<HTMLAnchorElement>('[data-toc-link]');
  if (links.length === 0) return;

  const body = document.querySelector('.post-body');
  if (!body) return;

  const headings = Array.from(
    body.querySelectorAll<HTMLElement>('h2[id], h3[id], h4[id], h5[id], h6[id]'),
  );
  if (headings.length === 0) return;

  const byId = new Map<string, HTMLAnchorElement>();
  for (const link of links) {
    const id = link.getAttribute('data-toc-link') ?? '';
    if (id !== '') byId.set(id, link);
  }
  if (byId.size === 0) return;

  let activeId = '';
  let scheduled = false;

  const update = (): void => {
    scheduled = false;
    const offset = headerOffset();
    let current = headings[0]?.id ?? '';
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top - offset <= 1) current = heading.id;
      else break;
    }
    if (current === activeId) return;
    activeId = current;
    for (const [id, link] of byId) link.classList.toggle('is-active', id === current);
  };

  const onScroll = (): void => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}