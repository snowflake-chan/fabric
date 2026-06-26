/**
 * CLI — FabricFS 调试 shell 的终端界面层
 *
 * 职责：提供 cout（console.log）给 DebugShell，将命令输出打印到终端。
 * 所有渲染在 handler 内通过 cout 完成，本层不再关心数据结构。
 *
 * 颜色约定：
 *   console.log  — 普通输出（由 shell handler 通过 cout 产生）
 *   console.warn — 状态提示（✓、→）
 *   console.error — 错误信息（✗）
 */

import { createShell, type Cout } from './shell';
import { type IFileSystem } from '../fs/fabric-fs';
import { type FabricVFS } from '../fs/fabric-vfs';

// ---- CLI 工厂 ---------------------------------------------------------------

export function createCLI(
  fs: IFileSystem,
  vfs?: FabricVFS,
  mountStorage?: (path: string, storageId: string) => Promise<void>,
  worldOnTick?: (cb: () => void) => void
) {
  const cout: Cout = async (line: string) => {
    console.log(line);
  };

  const shell = createShell(fs, vfs, mountStorage, worldOnTick);

  async function $(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<{ ok: boolean }> {
    const raw = strings.reduce(
      (acc, str, i) =>
        acc + str + (values[i] !== undefined ? String(values[i]) : ''),
      ''
    );
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true };

    const r = await shell.exec(trimmed, cout);

    if (!r.ok) {
      console.error(`✗ ${r.error}`);
      if (r.error.startsWith('unknown command:')) {
        console.warn('  (try: help)');
      }
    }
    return r;
  }

  // 挂到全局
  (globalThis as unknown as Record<string, unknown>).$ = $;

  return { $, shell };
}
