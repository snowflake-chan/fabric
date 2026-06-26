/**
 * DevFS — 虚拟设备文件系统
 *
 * 纯内存的虚拟文件系统，支持注册设备（VirtualDevice）和事件 socket。
 * 通常挂载到 /dev、/run 等路径下。
 *
 * 用法：
 *   const dev = new DevFS();
 *   dev.registerDevice('/dev/null', { readFile: () => '', writeFile: () => {} });
 *   vfs.mount('/dev', dev);
 */

import { type IFileSystem, type FileStat } from './FileSystem';
import { EventSocket } from './EventSocket';
import { Path } from './Path';

// ---- VirtualDevice（与之前一致）--------------------------------------------

export interface VirtualDevice {
  stat?: () => FileStat | Promise<FileStat>;
  readFile?: () => string | null | Promise<string | null>;
  writeFile?: (data: string) => void | Promise<void>;
  readdir?: () => string[] | Promise<string[]>;
}

// ---- DevFS ----------------------------------------------------------------

export class DevFS implements IFileSystem {
  private devices = new Map<string, VirtualDevice>();
  private sockets = new Map<string, EventSocket>();

  constructor() {
    // 默认设备
    this.devices.set('/dev', {
      stat: () => ({
        type: 'dir',
        mode: 0o555,
        size: 0,
        uid: 0,
        gid: 0,
        atime: 0,
        mtime: 0,
        ctime: 0,
        nlinks: 2,
      }),
      readdir: () => {
        const kids: string[] = [];
        for (const k of this.devices.keys()) {
          if (k.startsWith('/dev/') && k !== '/dev') {
            const name = k.substring(5);
            if (!name.includes('/')) kids.push(name);
          }
        }
        return kids.sort();
      },
    });

    // 内置 /dev/null
    this.devices.set('/dev/null', {
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
      writeFile: () => {
        /* 静默丢弃 */
      },
    });

    this.devices.set('/dev/zero', {
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

    this.devices.set('/dev/random', {
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

  // ------------------------------------------------------------------
  //  注册 API
  // ------------------------------------------------------------------

  /**
   * 注册一个虚拟设备。
   * 自动创建父目录设备（/dev/foo → /dev 自动建）。
   */
  registerDevice(path: string, handler: VirtualDevice): void {
    this.devices.set(path, handler);
    this.ensureParentDir(path);
  }

  /**
   * 注册一个事件 socket。
   * 返回 EventSocket，引擎侧通过 .push(line) 推数据。
   */
  registerSocket(path: string): EventSocket {
    const sock = new EventSocket();
    this.sockets.set(path, sock);
    this.devices.set(path, {
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
      readFile: () => sock.readLine(),
      writeFile: (data) => sock.push(data),
    });
    this.ensureParentDir(path);
    return sock;
  }

  /** 确保父目录设备存在 */
  private ensureParentDir(p: string): void {
    const parent = Path.parent(p);
    if (parent === p || parent === '/') return;
    if (!this.devices.has(parent)) {
      this.devices.set(parent, {
        stat: () => ({
          type: 'dir',
          mode: 0o555,
          size: 0,
          uid: 0,
          gid: 0,
          atime: 0,
          mtime: 0,
          ctime: 0,
          nlinks: 2,
        }),
        readdir: () => {
          const kids: string[] = [];
          for (const k of this.devices.keys()) {
            if (k.startsWith(`${parent}/`) && k !== parent) {
              const name = k.substring(parent.length + 1);
              if (!name.includes('/')) kids.push(name);
            }
          }
          return kids.sort();
        },
      });
    }
  }

  // ------------------------------------------------------------------
  //  内部工具
  // ------------------------------------------------------------------

  private getDevice(path: string): VirtualDevice | undefined {
    return this.devices.get(path);
  }

  private isKnownPath(path: string): boolean {
    for (const k of this.devices.keys()) {
      if (path === k || path.startsWith(`${k}/`)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  //  IFileSystem
  // ------------------------------------------------------------------

  async init(): Promise<void> {
    // DevFS 无持久化，无需初始化
  }

  async exists(path: string): Promise<boolean> {
    return this.devices.has(path);
  }

  async stat(path: string): Promise<FileStat | null> {
    const dev = this.getDevice(path);
    if (dev?.stat) return await dev.stat();
    if (this.isKnownPath(path)) return null;
    return null;
  }

  async readFile(path: string): Promise<string | null> {
    const dev = this.getDevice(path);
    if (dev?.readFile) return await dev.readFile();
    return null;
  }

  async writeFile(path: string, data: string): Promise<void> {
    const dev = this.getDevice(path);
    if (dev?.writeFile) {
      await dev.writeFile(data);
      return;
    }
    if (this.isKnownPath(path)) {
      throw new Error(`EROFS: cannot write '${path}': read-only`);
    }
    throw new Error(`ENOENT: ${path}`);
  }

  async mkdir(path: string): Promise<void> {
    throw new Error(`EROFS: cannot create '${path}': read-only`);
  }

  async readdir(path: string): Promise<string[]> {
    const dev = this.getDevice(path);
    if (dev?.readdir) return await dev.readdir();
    if (this.isKnownPath(path)) {
      throw new Error(`ENOTDIR: ${path} is not a directory`);
    }
    throw new Error(`ENOENT: ${path}`);
  }

  async unlink(path: string): Promise<void> {
    throw new Error(`EROFS: cannot unlink '${path}': read-only`);
  }

  async rmdir(path: string): Promise<void> {
    throw new Error(`EROFS: cannot rmdir '${path}': read-only`);
  }

  async rimraf(path: string): Promise<void> {
    throw new Error(`EROFS: cannot remove '${path}': read-only`);
  }

  async rename(_oldPath: string, _newPath: string): Promise<void> {
    throw new Error('EROFS: cannot rename in devfs');
  }

  async chmod(path: string, _mode: number): Promise<void> {
    throw new Error(`EROFS: cannot chmod '${path}': read-only`);
  }
}
