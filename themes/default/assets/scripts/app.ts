import { initCodeCopy } from './code';
import { initHeaderScroll, initReadingProgress, initTypewriter } from './effects';
import { initTocScrollSpy } from './toc';

const COLOR_KEY = 'inkery-color-mode';

function applyResolved(mode: string): void {
  const root = document.documentElement;
  root.setAttribute('data-resolved-mode', mode);
  root.classList.toggle('dark', mode === 'dark');
}

function storedMode(): string | null {
  try {
    return localStorage.getItem(COLOR_KEY);
  } catch {
    return null;
  }
}

function persistMode(mode: string): void {
  try {
    localStorage.setItem(COLOR_KEY, mode);
  } catch {
    /* 隐私模式下忽略 */
  }
}

function initThemeToggle(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  const mode = document.documentElement.getAttribute('data-color-mode') ?? 'auto';

  if (button) {
    button.addEventListener('click', () => {
      const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
      applyResolved(next);
      persistMode(next);
    });
  }

  if (mode !== 'auto') return;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', (event) => {
    if (storedMode()) return;
    applyResolved(event.matches ? 'dark' : 'light');
  });
}

function initNav(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-nav-toggle]');
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  if (!toggle || !nav) return;

  const setOpen = (open: boolean): void => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '收起导航' : '展开导航');
  };

  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) setOpen(false);
  });
}

function boot(): void {
  initThemeToggle();
  initNav();
  initHeaderScroll();
  initTypewriter();
  initReadingProgress();
  initTocScrollSpy();
  initCodeCopy();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}