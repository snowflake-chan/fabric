/**
 * TtyBridge — 服务端 TTY 桥梁
 *
 * 职责：
 *   监听客户端通过 RemoteChannel 发来的 shell 命令，
 *   通过 DebugShell 的 cout 机制逐行流式推给客户端。
 *
 * 多用户隔离：
 *   每个 RemoteChannel 实体（玩家）拥有独立的 shell 实例，
 *   包括独立的 uidRef、cwdRef、登录状态、环境变量。
 *   底层文件系统（vfs）是共享的。
 *
 * 权限同步：
 *   每次执行命令前将 sharedUidRef 同步为当前 shell 的 uid，
 *   使 RootFS 的权限检查以当前用户为准，执行完恢复。
 */

import { type Cout } from './commands/types';
import { createShell } from './shell';
import { type IFileSystem } from '../fs/fabric-fs';
import type { FabricVFS } from '../fs/fabric-vfs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Entity = any;

type Shell = ReturnType<typeof createShell>;

interface Session {
  shell: Shell;
  /** 交互输入等待（ed 等命令阻塞在此） */
  inputResolver: ((line: string) => void) | null;
}

export function createTtyBridge(
  fs: IFileSystem,
  vfs?: FabricVFS,
  mountStorage?: (path: string, storageId: string) => Promise<void>,
  sharedUidRef?: { value: number },
  privFs?: IFileSystem
): void {
  const sessions = new Map<string, Session>();

  function getSession(entity: Entity): Session {
    const key = String(entity?.player?.userId ?? entity?.id ?? 'anon');
    let s = sessions.get(key);
    if (!s) {
      s = {
        shell: createShell(
          fs,
          vfs,
          mountStorage,
          { value: 0 },
          undefined,
          sharedUidRef,
          privFs
        ),
        inputResolver: null,
      };
      sessions.set(key, s);
    }
    return s;
  }

  remoteChannel.onServerEvent(async (event) => {
    const { args, entity } = event;
    const msg = args as Record<string, unknown>;
    if (msg?.type !== 'tty-cmd' || typeof msg.cmd !== 'string') return;

    const session = getSession(entity);
    const { shell } = session;

    // 有命令在等输入 → 喂给它
    if (session.inputResolver) {
      const r = session.inputResolver;
      session.inputResolver = null;
      r(msg.cmd);
      return;
    }

    // 供 shell 内部使用的 inputLine 函数
    const inputLine = async (): Promise<string> => {
      return new Promise((resolve) => {
        session.inputResolver = resolve;
      });
    };

    // heredoc 静默输入（客户端不 echo）
    const quietInputLine = async (): Promise<string> => {
      remoteChannel.sendClientEvent(entity, { type: 'tty-noecho' });
      const line = await inputLine();
      remoteChannel.sendClientEvent(entity, { type: 'tty-echo' });
      return line;
    };

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
        data: `${chunk.join('\n')}\n`,
        style: 'output',
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

    const print = async (text: string) => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushBatch();
      remoteChannel.sendClientEvent(entity, { type: 'tty-stream', data: text });
    };

    const requestPassword = async (): Promise<string> => {
      remoteChannel.sendClientEvent(entity, { type: 'tty-password' });
      return inputLine();
    };

    const colorPrint = async (text: string, color: string) => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushBatch();
      remoteChannel.sendClientEvent(entity, {
        type: 'tty-stream',
        data: text,
        style: color,
      });
    };

    const result = await shell.exec(
      msg.cmd,
      cout,
      0,
      inputLine,
      print,
      requestPassword,
      colorPrint,
      quietInputLine
    );

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

    // 登录成功后清屏
    if (result.ok && msg.cmd === 'login') {
      remoteChannel.sendClientEvent(entity, { type: 'tty-clear' });
    }

    // 输出 prompt（~ 替换 home）
    const userName = typeof shell.user === 'function' ? await shell.user() : '';
    const cwd = shell.cwd();
    const home = userName === 'root' ? '/root' : `/home/${userName}`;
    const display =
      cwd === home
        ? '~'
        : cwd.startsWith(`${home}/`)
          ? `~${cwd.slice(home.length)}`
          : cwd;
    remoteChannel.sendClientEvent(entity, {
      type: 'tty-stream',
      data: `${userName} ${display}${userName === 'root' ? '#' : '$'} `,
      style: 'prompt',
    });
  });

  console.warn('✓ TTY bridge ready');
}
