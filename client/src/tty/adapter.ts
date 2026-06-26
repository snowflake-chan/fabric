/**
 * TTY adapter — 将不同类型输出渲染为富文本
 *
 * Shell 输出纯文本，adapter 根据 style 决定颜色/格式。
 */

export type OutputStyle = 'output' | 'error' | 'prompt' | 'info' | 'dim';

const STYLE_COLORS: Record<OutputStyle, string> = {
  output: '#d2d2d2',
  error: '#ff5050',
  prompt: '#00dc50',
  info: '#3cb4ff',
  dim: '#646464',
};

/** 将一行文本按 style 渲染为富文本 */
export function renderLine(
  text: string,
  style: OutputStyle = 'output'
): string {
  const color = STYLE_COLORS[style];
  // 文本本身可能已包含富文本标签
  if (text.startsWith('<font ')) return text;
  return `<font color="${color}">${escXml(text)}</font>`;
}

/** 将多行文本按 style 渲染，每行独立着色 */
export function render(text: string, style: OutputStyle = 'output'): string {
  return text
    .split('\n')
    .map((l) => renderLine(l, style))
    .join('\n');
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
