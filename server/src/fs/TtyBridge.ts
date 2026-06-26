/**
 * TtyBridge — 服务端 TTY 桥梁
 *
 * 职责：
 *   监听客户端通过 RemoteChannel 发来的 shell 命令，
 *   通过 DebugShell 执行，将结果返回给对应的客户端。
 *
 * 协议：
 *   客户端 → 服务端  { type: "tty-cmd", cmd: "ls /" }
 *   服务端 → 客户端  { type: "tty-result", result: ShellResult }
 */

import { type createShell } from './DebugShell';

type Shell = ReturnType<typeof createShell>;

export function createTtyBridge(shell: Shell): void {
  remoteChannel.onServerEvent(async (event) => {
    const { args, entity } = event;
    const msg = args as Record<string, unknown>;

    // 只处理 tty 命令
    if (msg?.type !== 'tty-cmd' || typeof msg.cmd !== 'string') return;

    // 执行命令
    const result = await shell.exec(msg.cmd);

    // 将结果发回给该客户端
    remoteChannel.sendClientEvent(entity, {
      type: 'tty-result',
      result,
    });
  });

  console.warn('✓ TTY bridge ready');
}
