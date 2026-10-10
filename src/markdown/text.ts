import type { MarkdownIt, StateCore, Token } from 'markdown-it';

/**
 * 给块级 token 标注源码行号（0 基，相对正文首行）。
 * 编辑器用它与预览块做滚动同步。
 */
export function blockLinePlugin(md: MarkdownIt): void {
  md.core.ruler.push('inkery_block_lines', (state: StateCore) => {
    for (const token of state.tokens) annotate(token);
    return true;
  });
}

function annotate(token: Token): void {
  if (!token.map || token.type === 'math_inline') return;
  if (token.nesting === 1 || (token.nesting === 0 && token.block === true)) {
    token.attrSet('data-src-line', String(token.map[0]));
  }
}