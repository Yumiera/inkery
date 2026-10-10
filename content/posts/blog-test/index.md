---
title: "blog-test"
slug: "blog-test"
date: "2026-10-08 19:08:33"
tags:
  - "测试 示例"
categories:
  - "Java"
---
这是 Inkery 渲染管线的验收样例，覆盖代码高亮、公式、表格、任务列表、脚注、图片与摘要标记。

<!-- more -->

## 代码高亮

```javascript
const greet = (name) => `Hello, ${name}!`;
console.log(greet('Inkery'));
```

```bash
npm run blog -- build --clean
```

## 数学公式

行内公式 $a^2 + b^2 = c^2$ 与块级公式：

$$
E = mc^2
$$

## 表格

| 特性 | Hexo | Inkery |
| --- | --- | --- |
| 可视化后台 | 无 | 有 |
| 构建期高亮 | 插件 | 内置 |

## 任务列表

- [x] 内容层
- [ ] 生成器
- [ ] 后台 SPA

## 脚注

Markdown 支持脚注[^1]。

[^1]: 这是脚注内容。

## 图片

![测试图片](./a.png)

## 中文标题锚点

### 三级标题：多态与继承
