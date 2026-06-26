/**
 * UserDaemon — 提权守护进程
 *
 * 在 /run/userd/ 下挂载特权设备，普通用户通过文件 IO 访问，
 * 无需临时提权，不走 EventBus。
 *
 * 用法（App.ts）：
 *   const daemon = new UserDaemon(vfs);
 *   daemon.mount();
 */

import { type IFileSystem } from '../fs/fabric-fs';
import { VirtualFS } from '../fs/virtual-fs';
import { type FabricVFS } from '../fs/fabric-vfs';
import { simpleHash } from './helpers';

export class UserDaemon {
  private fs: VirtualFS;

  constructor(private vfs: FabricVFS) {
    this.fs = new VirtualFS(vfs.bus);
  }

  /** 挂载到 /run/userd */
  mount(): void {
    // shadow-get: root-only, 返回密码哈希
    this.fs.registerDevice('/shadow-get', {
      stat: () => ({
        type: 'file',
        mode: 0o600,
        size: 0,
        uid: 0,
        gid: 0,
        atime: 0,
        mtime: 0,
        ctime: 0,
        nlinks: 1,
      }),
      readFile: async () => {
        // 提权读取（daemon 始终以 root 身份运行）
        const s = await this.vfs.readFile('/etc/shadow');
        return s;
      },
    });

    // shadow-set: root-only, 写入密码哈希
    this.fs.registerDevice('/shadow-set', {
      stat: () => ({
        type: 'file',
        mode: 0o600,
        size: 0,
        uid: 0,
        gid: 0,
        atime: 0,
        mtime: 0,
        ctime: 0,
        nlinks: 1,
      }),
      writeFile: async (data) => {
        await this.vfs.writeFile('/etc/shadow', data);
        await this.vfs.chmod('/etc/shadow', 0o600);
      },
    });

    // verify: 验证密码
    this.fs.registerDevice('/verify', {
      stat: () => ({
        type: 'file',
        mode: 0o600,
        size: 0,
        uid: 0,
        gid: 0,
        atime: 0,
        mtime: 0,
        ctime: 0,
        nlinks: 1,
      }),
      writeFile: async (data) => {
        // 格式: "user:pass"
        const sep = data.indexOf(':');
        if (sep < 0) return;
        const user = data.slice(0, sep);
        const pass = data.slice(sep + 1).trim();
        const shadow = await this.vfs.readFile('/etc/shadow');
        let ok = false;
        if (shadow !== null) {
          for (const line of shadow.split('\n')) {
            const sp = line.split(':');
            if (sp[0] === user && sp[1] && simpleHash(pass) === sp[1]) {
              ok = true;
              break;
            }
          }
        }
        await this.vfs.writeFile(
          '/run/userd/verify-result',
          ok ? 'ok' : 'fail'
        );
      },
    });

    // verify-result: 可读写的临时结果文件
    let lastResult = '';
    this.fs.registerDevice('/verify-result', {
      stat: () => ({
        type: 'file',
        mode: 0o600,
        size: 0,
        uid: 0,
        gid: 0,
        atime: 0,
        mtime: 0,
        ctime: 0,
        nlinks: 1,
      }),
      readFile: () => lastResult,
      writeFile: (data) => {
        lastResult = data.trim();
      },
    });

    this.vfs.mount('/run/userd', this.fs);
  }
}
