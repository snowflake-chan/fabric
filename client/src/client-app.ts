import { TtyUI } from '@src/tty/tty-ui';

// 启动 TTY 终端（延迟一帧确保 RemoteChannel 就绪）
setTimeout(() => {
  const tty = new TtyUI();
  // 挂到全局方便调试
  (globalThis as Record<string, unknown>).__tty = tty;
}, 500);
