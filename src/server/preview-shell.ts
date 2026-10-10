import fs from 'node:fs';
import path from 'node:path';
import type { LoadedConfig } from '../config/load';
import { DEFAULT_ACCENT } from '../config/defaults';

let cachedCss = '';
let cachedMtime = -1;

/** 主题 CSS 直接读源文件（不依赖先跑一次构建），按 mtime 失效 */
function themeCss(themeDir: string): string {
  const file = path.join(themeDir, 'assets', 'styles', 'main.css');
  try {
    const stat = fs.statSync(file);
    if (stat.mtimeMs !== cachedMtime) {
      cachedCss = fs.readFileSync(file, 'utf8');
      cachedMtime = stat.mtimeMs;
    }
  } catch {
    /* 主题缺 CSS 时退化为空样式 */
  }
  return cachedCss;
}

function themeString(source: Record<string, unknown>, key: string, fallback: string): string {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/** iframe 壳页：与生产 post.ejs 同容器结构 + 主题 CSS，只负责接收 postMessage 局部更新 */
export function renderPreviewShell(loaded: LoadedConfig): string {
  const { config } = loaded;
  const themeConfig = config.theme.config;
  const accent = themeString(themeConfig, 'accentColor', DEFAULT_ACCENT);
  const colorMode = themeString(themeConfig, 'colorMode', 'auto');

  const client = `<script>
(function () {
  function apply(mode) {
    var root = document.documentElement;
    root.setAttribute('data-color-mode', mode);
    var resolved = mode;
    try {
      var stored = localStorage.getItem('inkery-color-mode');
      if (mode === 'auto') {
        resolved = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      }
    } catch (error) {
      resolved = mode === 'dark' ? 'dark' : 'light';
    }
    root.setAttribute('data-resolved-mode', resolved);
    if (resolved === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }

  apply(document.documentElement.getAttribute('data-color-mode') || 'auto');

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'render') {
      var title = document.getElementById('preview-title');
      if (title && typeof data.title === 'string') title.textContent = data.title;
      var meta = document.getElementById('preview-meta');
      if (meta && typeof data.meta === 'string') meta.innerHTML = data.meta;
      var content = document.getElementById('content');
      if (content) content.innerHTML = typeof data.html === 'string' ? data.html : '';
      return;
    }

    if (data.type === 'colorMode') {
      apply(data.mode);
      return;
    }

    if (data.type === 'scrollToLine') {
      var line = Number(data.line);
      if (!isFinite(line)) return;
      var nodes = document.querySelectorAll('[data-src-line]');
      var target = null;
      var best = -1;
      for (var i = 0; i < nodes.length; i++) {
        var value = Number(nodes[i].getAttribute('data-src-line'));
        if (value <= line && value >= best) {
          best = value;
          target = nodes[i];
        }
      }
      if (target) target.scrollIntoView({ block: 'start' });
    }
  });

  try {
    parent.postMessage({ type: 'shell-ready' }, '*');
  } catch (error) {
    /* 独立打开时忽略 */
  }
})();
<\/script>`;

  return [
    '<!DOCTYPE html>',
    `<html lang="${config.site.lang}" data-color-mode="${colorMode}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>预览</title>',
    '<meta name="robots" content="noindex,nofollow">',
    `<style>${themeCss(loaded.themeDir)}</style>`,
    `<style>:root{--accent-light:${accent};--accent:var(--accent-light);--accent-soft:color-mix(in srgb,var(--accent) 12%,transparent);--link:color-mix(in srgb,var(--accent) 82%,#000);--accent-solid:var(--link);--accent-on:#ffffff;}html.dark{--accent:color-mix(in srgb,var(--accent-light) 74%,#fff);--accent-soft:color-mix(in srgb,var(--accent) 20%,transparent);--link:var(--accent);--accent-solid:var(--accent);--accent-on:#1a1918;}</style>`,
    '<style>.preview-shell{padding:24px 0 40px;}</style>',
    '</head>',
    '<body class="preview-shell">',
    '<main class="site-main">',
    '<div class="container">',
    '<div class="post-layout no-toc">',
    '<article class="post">',
    '<header class="post-header">',
    '<h1 class="post-title" id="preview-title"></h1>',
    '<div class="post-meta" id="preview-meta"></div>',
    '</header>',
    '<div class="post-body" id="content"></div>',
    '</article>',
    '</div>',
    '</div>',
    '</main>',
    client,
    '</body>',
    '</html>',
  ].join('\n');
}