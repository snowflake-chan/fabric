/**
 * EventSocket — 事件套接字
 *
 * 用于游戏引擎事件 → Fabric shell 的流式通道。
 * 类似 Unix domain socket 的语义：
 *   写（push）不阻塞，读（readLine）在无数据时挂起等待。
 *
 * 使用流程：
 *   const sock = new EventSocket();
 *   vfs.registerSocket('/run/events/chat', sock);
 *
 *   // 引擎侧推数据
 *   world.events.on('playerChat', (p, m) => sock.push(`[${p.name}] ${m}`));
 *
 *   // Shell 测读数据
 *   sock cat /run/events/chat   → 每一行实时输出
 */

export class EventSocket {
  private buffer: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  private _closed = false;

  /** 引擎侧推入一行数据 */
  push(line: string): void {
    if (this._closed) return;
    if (this.waiters.length > 0) {
      // 有等待的读取者 → 广播给所有人
      const ws = this.waiters.splice(0);
      for (const w of ws) {
        w(line);
      }
    } else {
      // 无等待者 → 入缓冲区
      this.buffer.push(line);
    }
  }

  /**
   * Shell 侧读取一行数据。
   * 有缓冲数据 → 立即返回；无数据 → 挂起等待（最长 30s）。
   * 返回 null 表示超时或连接已关闭。
   */
  async readLine(): Promise<string | null> {
    if (this._closed) return null;

    if (this.buffer.length > 0) {
      return this.buffer.shift()!;
    }

    return new Promise<string | null>((resolve) => {
      this.waiters.push(resolve);
      // 30 秒超时，避免永远挂住
      setTimeout(() => {
        const idx = this.waiters.indexOf(resolve);
        if (idx !== -1) {
          this.waiters.splice(idx, 1);
          resolve(null);
        }
      }, 30000);
    });
  }

  /** 关闭 socket，所有等待的读取者收到 null */
  close(): void {
    this._closed = true;
    for (const w of this.waiters) {
      w('');
    }
    this.waiters = [];
  }

  get closed(): boolean {
    return this._closed;
  }
}
