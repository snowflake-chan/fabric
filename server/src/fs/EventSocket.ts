/**
 * EventSocket — 事件套接字（基于 EventBus）
 *
 * 用于游戏引擎事件 → Fabric shell 的流式通道。
 * 底层使用 EventBus 做 pub/sub，同进程内 TypeScript 代码
 * 可以直接 bus.on(channel, cb) 接收，无需走文件 IO。
 *
 * 使用流程：
 *   const bus = new EventBus();
 *   const sock = new EventSocket(bus, '/chat');
 *
 *   // TS 代码直接订阅
 *   bus.on('/chat', (msg) => console.log(msg));
 *
 *   // Shell 通过文件读取
 *   vfs.registerSocket('/run/events/chat', sock);
 *   sock cat /run/events/chat
 */

import type { EventBus } from './EventBus';

export class EventSocket {
  private buffer: string[] = [];
  private _closed = false;

  /**
   * @param bus     事件总线（同一进程共享实例）
   * @param channel 此 socket 的频道名
   */
  constructor(
    private bus: EventBus,
    private channel: string
  ) {}

  /** 推入一行数据（= bus.emit） */
  push(line: string): void {
    if (this._closed) return;
    // 通过总线广播给所有订阅者（包括同一进程的 onTick 回调）
    this.bus.emit(this.channel, line);
    // 也入缓冲区（供 readLine / tryRead 使用）
    this.buffer.push(line);
  }

  /** 读取一行数据（阻塞等待，30s 超时） */
  async readLine(): Promise<string | null> {
    if (this._closed) return null;
    if (this.buffer.length > 0) return this.buffer.shift()!;

    return new Promise<string | null>((resolve) => {
      const off = this.bus.on(this.channel, (data) => {
        off();
        resolve(data);
      });
      // 超时兜底
      setTimeout(() => {
        off();
        resolve(null);
      }, 30000);
    });
  }

  /** 非阻塞读取，无数据立即返回 null */
  tryRead(): string | null {
    if (this._closed || this.buffer.length === 0) return null;
    return this.buffer.shift()!;
  }

  /** 关闭 */
  close(): void {
    this._closed = true;
    this.buffer = [];
  }

  get closed(): boolean {
    return this._closed;
  }
}
