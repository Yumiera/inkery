/** 代码块复制：行号由 CSS counter 生成，innerText 中不含行号 */

/** 部分浏览器在文档未聚焦时 clipboard.writeText 的 Promise 永不 settle，超时后降级 */
const COPY_TIMEOUT_MS = 400;

function readCode(pre: Element): string {
  const lines = pre.querySelectorAll('.line');
  if (lines.length === 0) return pre.textContent ?? '';
  return Array.from(lines, (line) => line.textContent ?? '').join('\n');
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function withTimeout(promise: Promise<boolean>): Promise<boolean> {
  return Promise.race([
    promise,
    new Promise<boolean>((resolve) => {
      window.setTimeout(() => resolve(false), COPY_TIMEOUT_MS);
    }),
  ]);
}

async function writeClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    const viaApi = navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
    if (await withTimeout(viaApi)) return true;
  }
  return legacyCopy(text);
}

export function initCodeCopy(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>('.code-copy');
  if (buttons.length === 0) return;

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const pre = button.closest('.code-block')?.querySelector('pre');
      void copy(button, pre ? readCode(pre) : '');
    });
  }
}

async function copy(button: HTMLButtonElement, text: string): Promise<void> {
  const label = button.dataset.label ?? button.textContent ?? '复制';
  const aria = button.dataset.aria ?? button.getAttribute('aria-label') ?? label;
  button.dataset.label = label;
  button.dataset.aria = aria;

  const ok = await writeClipboard(text);
  const message = ok ? '已复制' : '复制失败';
  button.textContent = message;
  button.setAttribute('aria-label', message);
  button.classList.toggle('is-done', ok);

  window.setTimeout(() => {
    button.textContent = label;
    button.setAttribute('aria-label', aria);
    button.classList.remove('is-done');
  }, 1600);
}