const TYPE_SPEED = 55;
const TYPE_DELAY = 240;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function onScrollFrame(update: () => void): () => void {
  let ticking = false;
  const handler = (): void => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      ticking = false;
      update();
    });
  };
  window.addEventListener('scroll', handler, { passive: true });
  window.addEventListener('resize', handler, { passive: true });
  return handler;
}

export function initTypewriter(): void {
  const host = document.querySelector<HTMLElement>('[data-typing-root]');
  const target = host?.querySelector<HTMLElement>('[data-typing]');
  if (!host || !target) return;

  const full = target.textContent ?? '';
  if (full.length === 0 || prefersReducedMotion()) {
    host.classList.add('is-done');
    return;
  }

  target.textContent = '';
  let index = 0;
  const step = (): void => {
    index += 1;
    target.textContent = full.slice(0, index);
    if (index < full.length) {
      window.setTimeout(step, TYPE_SPEED);
    } else {
      host.classList.add('is-done');
    }
  };
  window.setTimeout(step, TYPE_DELAY);
}

export function initHeaderScroll(): void {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return;
  const update = (): void => {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  update();
  onScrollFrame(update);
}

export function initReadingProgress(): void {
  const bar = document.querySelector<HTMLElement>('[data-reading-progress]');
  const host = bar?.parentElement;
  if (!bar || !host) return;

  const update = (): void => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.setProperty('--progress', `${(ratio * 100).toFixed(2)}%`);
    host.classList.toggle('is-active', ratio > 0.01);
  };
  update();
  onScrollFrame(update);
}