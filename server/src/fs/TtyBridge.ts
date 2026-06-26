/**
 * TtyBridge — 服务端 TTY 桥梁
 *
 * 职责：
 *   监听客户端通过 RemoteChannel 发来的 shell 命令，
 *   通过 DebugShell 执行，将结果返回给对应的客户端。
 *
 * 协议：
 *   客户端 → 服务端  { type: "tty-cmd", cmd: "ls /" }
 *   服务端 → 客户端  (n × { type: "tty-stream", data: "line" }) — 流式行
 *   服务端 → 客户端  { type: "tty-result", result: ShellResult }  — 最终结果
 */

import { type createShell } from './DebugShell';

type Shell = ReturnType<typeof createShell>;

export function createTtyBridge(shell: Shell): void {
  remoteChannel.onServerEvent(async (event) => {
    const { args, entity } = event;
    const msg = args as Record<string, unknown>;

    // 只处理 tty 命令
    if (msg?.type !== 'tty-cmd' || typeof msg.cmd !== 'string') return;

    // 流式执行：攒批发送，每批 yield 一次让引擎刷新
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

    const result = await shell.execStream(msg.cmd, async (line: string) => {
      batch.push(line);
      if (batch.length >= BATCH_SIZE) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flushBatch();
        // yield 让引擎有机会 flush 事件到客户端
        await new Promise((r) => setTimeout(r, 0));
      } else if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushBatch();
        }, FLUSH_MS);
      }
    });

    // 刷干净剩余的行
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushBatch();

    // 最终结果（流式命令的 result.data 为 undefined，非流式的照常）
    remoteChannel.sendClientEvent(entity, {
      type: 'tty-result',
      result,
    });
  });

  console.warn('✓ TTY bridge ready');
}
