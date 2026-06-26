/**
 * EventBus — 进程内事件总线
 *
 * 轻量 pub/sub，同一个进程内的各模块通过 channel 收发事件。
 * EventSocket 基于 EventBus 实现：push = emit, readLine = 监听。
 *
 * 用法：
 *   const bus = new EventBus();
 *   const off = bus.on('/chat', (data) => console.log(data));
 *   bus.emit('/chat', 'hello');
 *   off(); // 取消订阅
 */

export class EventBus {
  private listeners = new Map<string, Set<(data: string) => void>>();

  /** 订阅事件。返回取消订阅函数。 */
  on(channel: string, cb: (data: string) => void): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
    };
  }

  /** 取消订阅 */
  off(channel: string, cb: (data: string) => void): void {
    this.listeners.get(channel)?.delete(cb);
  }

  /** 发布事件 */
  emit(channel: string, data: string): void {
    const set = this.listeners.get(channel);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(data);
      } catch {
        /*  consumer 自身处理异常 */
      }
    }
  }

  /** 移除 channel 的所有订阅 */
  clear(channel?: string): void {
    if (channel) this.listeners.delete(channel);
    else this.listeners.clear();
  }
}
