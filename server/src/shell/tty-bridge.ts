/**
 * TtyBridge — 服务端 TTY 桥梁
 *
 * 职责：
 *   监听客户端通过 RemoteChannel 发来的 shell 命令，
 *   通过 DebugShell 的 cout 机制逐行流式推给客户端。
 *
 * 输入路由（distributor）：
 *   所有输入走 tty-cmd。如果有命令在等输入（ed），
 *   下一行直接喂给它；否则正常执行命令。
 */

import { type createShell, type Cout } from './shell';

type Shell = ReturnType<typeof createShell>;

export function createTtyBridge(shell: Shell): void {
  /** 交互输入等待（ed 等命令阻塞在此） */
  let inputResolver: ((line: string) => void) | null = null;

  /** 供 shell 内部使用的 inputLine 函数 */
  const inputLine = async (): Promise<string> => {
    return new Promise((resolve) => {
      inputResolver = resolve;
    });
  };

  remoteChannel.onServerEvent(async (event) => {
    const { args, entity } = event;
    const msg = args as Record<string, unknown>;
    if (msg?.type !== 'tty-cmd' || typeof msg.cmd !== 'string') return;

    // 有命令在等输入 → 喂给它
    if (inputResolver) {
      const r = inputResolver;
      inputResolver = null;
      r(msg.cmd);
      return;
    }

    // 流式 cout
    const BATCH_SIZE = 5;
    const FLUSH_MS = 50;
    const batch: string[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushBatch(): void {
      if (batch.length === 0) return;
      const chunk = batch.splice(0);
      remoteChannel.sendClientEvent(entity, {
        type: 'tty-stream',
        data: chunk.join('\n'),
      });
    }

    const cout: Cout = async (line: string) => {
      batch.push(line);
      if (batch.length >= BATCH_SIZE) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flushBatch();
        await new Promise((r) => setTimeout(r, 0));
      } else if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushBatch();
        }, FLUSH_MS);
      }
    };

    const result = await shell.exec(msg.cmd, cout, 0, inputLine);

    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushBatch();

    remoteChannel.sendClientEvent(entity, {
      type: 'tty-result',
      result,
      cwd: shell.cwd(),
    });
  });

  console.warn('✓ TTY bridge ready');
}
