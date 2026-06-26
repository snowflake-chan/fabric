/**
 * DevFS — 标准设备文件系统（继承 VirtualFS）
 *
 * VirtualFS + 标准设备（null、zero、random）。
 * 用于挂载 /dev。不想带标准设备的用 VirtualFS 即可。
 *
 * 用法：
 *   const dev = new DevFS(bus);
 *   vfs.mount('/dev', dev);
 */

import { VirtualFS } from './virtual-fs';
import type { EventBus } from './event-bus';

export class DevFS extends VirtualFS {
  constructor(bus: EventBus) {
    super(bus);

    // 标准设备
    this.registerDevice('/null', {
      stat: () => ({
        type: 'file',
        mode: 0o666,
        size: 0,
        uid: 0,
        gid: 0,
        atime: 0,
        mtime: 0,
        ctime: 0,
        nlinks: 1,
      }),
      readFile: () => '',
      writeFile: () => {},
    });

    this.registerDevice('/zero', {
      stat: () => ({
        type: 'file',
        mode: 0o444,
        size: 4096,
        uid: 0,
        gid: 0,
        atime: 0,
        mtime: 0,
        ctime: 0,
        nlinks: 1,
      }),
      readFile: () => '\0'.repeat(4096),
    });

    this.registerDevice('/random', {
      stat: () => ({
        type: 'file',
        mode: 0o444,
        size: 4096,
        uid: 0,
        gid: 0,
        atime: 0,
        mtime: 0,
        ctime: 0,
        nlinks: 1,
      }),
      readFile: () => {
        const chars = 'abcdef0123456789';
        let r = '';
        for (let i = 0; i < 4096; i++)
          r += chars[Math.floor(Math.random() * 16)];
        return r;
      },
    });
  }
}
