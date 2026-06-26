/**
 * CLI — FabricFS 调试 shell 的终端界面层
 *
 * 职责：tagged template 解析 → 调用 DebugShell.exec → console 输出
 * 与 Shell 层的边界：Shell 返回结构化 ShellResult，CLI 负责渲染。
 *
 * 颜色约定：
 *   console.log  — 普通输出（文件内容、目录列表）
 *   console.warn — 状态提示（✓ 成功、→ 操作、header）
 *   console.error — 错误信息（✗）
 */

import { type ShellResult, createShell } from './DebugShell';
import { type FabricFS } from './FileSystem';

function printStat(st: StatLike): void {
  const typeStr = st.type === 'dir' ? 'd' : '-';
  const modeStr =
    ((st.mode >> 6) & 7).toString(8) +
    ((st.mode >> 3) & 7).toString(8) +
    (st.mode & 7).toString(8);
  const lines = [
    `${typeStr}${modeStr}  ${st.nlinks}  ${st.uid}:${st.gid}`,
    `  size: ${st.size}`,
    `  atime: ${new Date(st.atime).toISOString()}`,
    `  mtime: ${new Date(st.mtime).toISOString()}`,
    `  ctime: ${new Date(st.ctime).toISOString()}`,
  ];
  lines.forEach((l) => console.log(l));
}

function printTree(nodes: TreeNode[], prefix: string): void {
  for (let i = 0; i < nodes.length; i++) {
    const isLast = i === nodes.length - 1;
    const connector = isLast ? '└─ ' : '├─ ';
    console.log(`${prefix}${connector}${nodes[i].name}`);
    if (nodes[i].children) {
      printTree(nodes[i].children!, prefix + (isLast ? '   ' : '│  '));
    }
  }
}

// ── 渲染函数（ShellResult → console） ──────────────────────────────────────

function printResult(r: ShellResult): void {
  if (!r.ok) {
    console.error(`✗ ${r.error}`);
    return;
  }
  const d = r.data;
  if (d === undefined || d === null) return;

  // 根据不同数据类型渲染
  if (typeof d === 'string') {
    console.log(d);
  } else if (Array.isArray(d)) {
    // ls / tree / help 返回数组
    if (d.length > 0 && typeof d[0] === 'object' && 'isDir' in d[0]) {
      // ls 结果：{ name, isDir }[]
      const line = (d as { name: string; isDir: boolean }[])
        .map((e) => (e.isDir ? `${e.name}/` : e.name))
        .join('  ');
      console.log(line);
    } else if (d.length > 0 && typeof d[0] === 'object' && 'children' in d[0]) {
      // tree 结果：TreeNode[]
      printTree(d as TreeNode[], '');
    } else {
      // 普通数组（如 help → 命令名列表）
      d.forEach((item) => console.log(item));
    }
  } else if (typeof d === 'object' && d !== null) {
    // 单对象（stat / mv / echo 结果）
    if ('type' in d && 'size' in d) {
      // stat 结果
      printStat(d as StatLike);
    } else if ('from' in d && 'to' in d) {
      // mv / cd 结果
      console.warn(
        `  ${(d as { from: string }).from} → ${(d as { to: string }).to}`
      );
    } else if ('path' in d && 'text' in d) {
      // echo > 结果
      console.warn(`  → written ${(d as { path: string }).path}`);
    } else {
      console.log(d);
    }
  }
}

interface StatLike {
  type: 'file' | 'dir';
  mode: number;
  nlinks: number;
  uid: number;
  gid: number;
  size: number;
  atime: number;
  mtime: number;
  ctime: number;
}

interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

// ── CLI 工厂 ───────────────────────────────────────────────────────────────

export function createCLI(fs: FabricFS) {
  const shell = createShell(fs);

  async function $(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<ShellResult> {
    // 拼回完整命令字符串
    const raw = strings.reduce(
      (acc, str, i) =>
        acc + str + (values[i] !== undefined ? String(values[i]) : ''),
      ''
    );
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, data: undefined };

    const r = await shell.exec(trimmed);

    // 未知命令时额外提示
    if (!r.ok && r.error.startsWith('unknown command:')) {
      console.error(r.error);
      console.warn('  (try: help)');
      return r;
    }

    printResult(r);
    return r;
  }

  // 挂到全局
  (globalThis as unknown as Record<string, unknown>).$ = $;

  return { $, shell };
}
