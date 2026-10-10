# Inkery

可视化轻量级静态博客框架。TypeScript / ESM 编写，单进程单端口，自带可视化编辑界面「墨台」（Inkery Studio）。

- 内容即 Markdown：`content/` 下的文件就是全部数据源，随时可迁移
- 构建期渲染：代码高亮、公式、响应式图片都在构建时完成，产物是纯静态文件
- 幂等构建：只重写内容真正变化的文件，重复构建零写入
- SEO 与可访问性：JSON-LD、sitemap / RSS、hreflang、Open Graph、语义 HTML、亮暗双主题适配
- 墨台：文章列表与编辑器（CodeMirror + 实时预览）、站点设置、构建与一键部署，进度经 SSE 实时推送

## 环境要求

Node.js **>= 22.12.0**（依赖 ESM 与 `fs.cp` 的稳定行为）。构建图片变体需要 `sharp` 预编译二进制，首次 `npm install` 会按平台下载。

## 快速开始

```bash
npm install
npm run blog -- config init      # 生成 blog.config.json
npm run dev
```

`npm run dev` 启动后：

- 站点预览：http://127.0.0.1:4321/
- 墨台：http://127.0.0.1:4321/admin/

首次访问墨台不需要填任何凭据：服务端的 `tokenCookieMiddleware` 会自动下发 `blog_token` cookie。仅在更换浏览器或清除 cookie 后，才需要从启动横幅里的 `Token` 值手动恢复。

> **Windows PowerShell 提示**：`--` 会被 PowerShell 吞掉，导致参数落到 npm 自己手上。在 PowerShell 中请写成 `npm run blog '--' config init`，或直接在 cmd / Git Bash 中使用上面的标准写法。

## 命令行

所有命令通过 `npm run blog -- <命令>` 调用。

| 命令 | 说明 |
| --- | --- |
| `dev` | 启动墨台与站点预览（含 livereload），`--port` `--host` `--prod` `--no-open` `--no-build` |
| `build` | 生成静态站点到 `dist/`，`--clean` `--full` `--drafts` `--json` |
| `deploy` | 构建并推送到 Git 仓库，`--repo` `--branch` `--message` `--cname` `--no-force` `--no-build` `--dry-run` `--json` |
| `new` | 新建文章或草稿，`new "标题" [--slug <slug>] [--draft] [--tags a,b] [--category x]` |
| `ls` | 列出文章，`--drafts` `--all` `--tag x` `--category y` `--json` |
| `render` | 渲染单篇文章的 Markdown（调试用），`render <slug> [--stats] [--stdout] [--out <file>] [--json] [--repeat N]` |
| `config` | 初始化或打印站点配置，`config [init\|print] [--force] [--json] [--path]` |
| `clean` | 清理构建产物与缓存，`--dist-only` `--cache-only` `--all` |

`npm run build:admin` 单独构建墨台前端（产物在 `admin/dist/`，`dev --prod` 与生产托管需要它）；`npm run typecheck` 同时检查服务端与墨台两个项目。

## 目录结构

```text
inkery/
├── admin/                  墨台前端（Preact + Vite）
│   ├── src/
│   │   ├── components/     构建面板、部署面板、编辑器、对话框、通知条
│   │   ├── pages/          列表页、编辑页、设置页
│   │   ├── api.ts          接口客户端（令牌取自 cookie）
│   │   ├── store.ts        全局状态与 SSE 订阅
│   │   └── styles.css      设计令牌与组件样式
│   └── index.html
├── content/                内容源（唯一数据源）
│   ├── posts/              已发布文章，每篇一个目录 + index.md
│   ├── drafts/             草稿
│   ├── pages/              独立页面（about 等）
│   └── static/             原样拷贝到产物根目录的静态文件
├── scaffolds/              新建内容的模板（post / draft / page）
├── src/
│   ├── cli/                命令行入口与各子命令
│   ├── config/             配置 schema、默认值、加载与序列化
│   ├── content/            frontmatter 解析、文章索引、内容读写
│   ├── deploy/             部署核心（暂存、提交、推送）
│   ├── generator/          构建流水线（路由、模板、图片、sitemap、RSS）
│   ├── markdown/           渲染引擎（高亮、公式、目录、图片、摘要）
│   ├── server/             Hono 服务端与墨台接口
│   └── util/               日志、路径、日期、哈希等工具
├── themes/default/         默认主题（EJS 模板 + CSS + 前端脚本）
└── blog.config.json        站点配置（不入库，由 config init 生成）
```

## 配置

`blog.config.json` 会被 `deepMerge` 到内置默认值之上，所以只需写与默认值不同的部分。完整结构与说明：

| 段 | 关键字段 |
| --- | --- |
| `site` | `title` `subtitle` `description` `keywords` `author` `email` `lang` `timezone` `url` `baseUrl` `logo` `favicon` `defaultCover` `footerHtml` |
| `navigation` | `{ text, link }[]`，顶部导航 |
| `social` | `{ name, link, icon }[]`，页脚社交链接 |
| `permalinkPattern` | 文章永久链接模板，必须包含 `:slug`，默认 `/posts/:slug/` |
| `theme` | `name` 指定主题目录，`config` 为主题自定义配置 |
| `server` | `host` `port` `open` |
| `build` | `outDir` `drafts` `cache` `concurrency` `minify` `shiki.extraLangs` |
| `deploy` | `type` `enabled` `repo` `branch` `forcePush` `message` `cname` |

`site.url` 是绝对链接的来源（`sitemap.xml`、`feed.xml`、`og:url`、`JSON-LD`），部署前应填成真实域名。`site.baseUrl` 用于子路径部署，用户站点或自定义域名填 `/`。

默认主题的 `theme.config`：

| 字段 | 说明 |
| --- | --- |
| `accentColor` | 强调色，由其推导亮暗两套配色的可读前景色 |
| `colorMode` | `auto` / `light` / `dark` |
| `postsPerPage` | 列表分页大小 |
| `tocDepth` | 目录提取层级 |
| `showReadingTime` | 是否显示阅读时长 |
| `codeTheme` | `{ light, dark }`，Shiki 主题名 |

## 墨台

墨台是随服务端一起启动的可视化界面，位于 `/admin/`。

- **文章列表**：按状态、标签、分类、关键词过滤与排序，复制 slug、预览、移入回收站、删除
- **编辑器**：CodeMirror 6 编辑 Markdown，右侧 iframe 实时预览；frontmatter 表单化编辑；图片可直接粘贴或拖拽上传；带自动保存与冲突检测（文件被外部改动时提示覆盖或重新载入）
- **站点设置**：站点基础信息与部署目标表单化编辑，保存后服务端热重载配置并自动重建，无需重启进程
- **状态坞**：底部固定两条状态条。「构建」触发增量构建；「部署」执行构建 + 推送，「日志」可展开查看 git 输出
- **实时通道**：单一 `GET /api/livereload` SSE 端点承载构建进度、部署进度与产物变更

接口鉴权：除 `GET /api/meta`（下发令牌 cookie）与 `/api/health` 外，所有 `/api/*` 都需要 `X-Blog-Token` 请求头与 cookie 中的令牌一致。服务默认只监听 `127.0.0.1`。

## 内容与 frontmatter

文章放在 `content/posts/<slug>/index.md`，同目录下的其他文件作为该文章的静态资源（图片会生成响应式变体：宽度档位 `480 / 768 / 1200`，仅对 `.png` `.jpg` `.jpeg` `.webp` 生效，不足两档时不输出 `srcset`）。

```yaml
---
title: "文章标题"
slug: "custom-slug"        # 省略时由目录名决定
date: "2026-10-10 12:00:00"
updated: "2026-10-11 09:30:00"
tags: ["标签一", "标签二"]
categories: ["分类"]
cover: "cover.png"
coverAlt: "封面替代文本"
excerpt: "自定义摘要"
description: "SEO 描述"
keywords: ["关键词"]
author: "作者"
lang: "zh-CN"
pinned: false              # 列表置顶
toc: true                  # 输出目录
math: auto                 # true / false / auto（正文含 $ 才启用）
comments: true
hidden: false              # 不进入列表与 sitemap
aliases: ["/old-path/"]    # 生成跳转页
series: "系列名"
---
```

正文中用 `<!-- more -->` 标记摘要截断位置。草稿位于 `content/drafts/`，`build --drafts` 可预览草稿。

## 部署

内置 Git 部署：把 `dist/` 产物推送到指定仓库的指定分支。

```json
{
  "deploy": {
    "type": "git",
    "enabled": true,
    "repo": "owner/repo",
    "branch": "main",
    "forcePush": true,
    "message": "chore: publish {{date}}",
    "cname": ""
  }
}
```

- `repo` 支持 `owner/repo` 简写（补全为 `https://github.com/owner/repo.git`）或任意 Git 地址（含 SSH）
- `message` 支持 `{{date}}` 占位符，按 `site.timezone` 渲染
- `cname` 非空时会向产物根目录写入 `CNAME`
- 产物暂存在 `.deploy/`（独立仓库，保留 `.git` 以支持增量提交，已被 `.gitignore` 忽略）

执行 `npm run deploy`，或在墨台底部点「部署」。构建产出 `.nojekyll`，GitHub Pages 会跳过 Jekyll 处理。

**注意**

- 部署到 `owner.github.io` 这类用户站点仓库时必须用根路径，即 `site.baseUrl` 为 `/`
- `forcePush` 会以 `git push --force` 覆盖远端分支历史，确认远端没有需要保留的提交
- HTTPS 方式推送需要凭据（Personal Access Token 或凭据管理器缓存）；服务端推送无法交互输入凭据，首次建议在终端执行一次 `npm run deploy` 以完成授权缓存

## 主题

主题是 `themes/<name>/` 下的一个目录，由 `theme.name` 选中：

```text
themes/default/
├── layout.ejs              页面骨架
├── theme.json              主题元信息
├── pages/                  各页面类型模板（index / post / page / archive / taxonomy / 404）
├── partials/               可复用片段（head / header / footer / seo / jsonld / toc / pagination）
├── feeds/                  robots / rss / sitemap 模板
└── assets/                 styles/ 与 scripts/，前端资源由 esbuild 打包
```

`pages/` 中的模板可用的页面类型有 `index`、`archive`、`taxonomy`、`term`、`post`、`page`、`notfound`、`alias`。分页页（如 `/page/2/`）输出 `noindex, follow` 且不进入 sitemap。

## 技术栈

服务端 Hono 4 + `@hono/node-server`；模板 EJS 7；Markdown markdown-it 15；代码高亮 Shiki 4；公式 MathJax；图片 sharp；配置校验 zod 4；前端打包 esbuild；文件监听 chokidar 5；开发运行 tsx。
墨台 Preact 10 + `@preact/signals` + `wouter`，编辑器 CodeMirror 6，构建工具 Vite 8。

## 许可

[MIT](LICENSE)
