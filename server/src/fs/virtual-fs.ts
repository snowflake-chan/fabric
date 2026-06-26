/**
 * VirtualFS — 虚拟设备文件系统（纯内存）
 *
 * 纯内存的虚拟文件系统，支持注册设备（VirtualDevice）和事件 socket。
 * 通常挂载到 /dev、/run 等路径下。
 *
 * 用法：
 *   const vfs = new VirtualFS(bus);
 *   vfs.registerSocket('/events/chat');
 *   vfs.mount('/run', dev);
 */

import { type IFileSystem, type FileStat } from './fabric-fs';
import type { EventBus } from './event-bus';
import { EventSocket } from './event-socket';
import { Path } from './path';

// ---- VirtualDevice --------------------------------------------------------

export interface VirtualDevice {
  stat?: () => FileStat | Promise<FileStat>;
  readFile?: () => string | null | Promise<string | null>;
  writeFile?: (data: string) => void | Promise<void>;
  readdir?: () => string[] | Promise<string[]>;
}

// ---- VirtualFS ------------------------------------------------------------

export class VirtualFS implements IFileSystem {
  protected devices = new Map<string, VirtualDevice>();
  private sockets = new Map<string, EventSocket>();

  constructor(private bus: EventBus) {
    this.devices.set('/', {
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
          if (k.startsWith('/') && k !== '/') {
            const rest = k.slice(1);
            const name = rest.split('/')[0];
            if (name && !kids.includes(name)) kids.push(name);
          }
        }
        return kids.sort();
      },
    });
  }

  // ------------------------------------------------------------------
  //  注册 API
  // ------------------------------------------------------------------

  registerDevice(path: string, handler: VirtualDevice): void {
    this.devices.set(path, handler);
    this.ensureParentDir(path);
  }

  registerSocket(path: string): EventSocket {
    const sock = new EventSocket(this.bus, path);
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
      readFile: () => sock.tryRead(),
      writeFile: (data) => sock.push(data),
    });
    this.ensureParentDir(path);
    return sock;
  }

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
      this.ensureParentDir(parent);
    }
  }

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

  async init(): Promise<void> {}

  async format(): Promise<void> {
    this.devices.clear();
    this.sockets.clear();
    // 重建根目录
    this.devices.set('/', {
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
          if (k.startsWith('/') && k !== '/') {
            const rest = k.slice(1);
            const name = rest.split('/')[0];
            if (name && !kids.includes(name)) kids.push(name);
          }
        }
        return kids.sort();
      },
    });
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
    if (this.isKnownPath(path))
      throw new Error(`EROFS: cannot write '${path}': read-only`);
    throw new Error(`ENOENT: ${path}`);
  }

  async mkdir(path: string): Promise<void> {
    throw new Error(`EROFS: cannot create '${path}': read-only`);
  }

  async readdir(path: string): Promise<string[]> {
    const dev = this.getDevice(path);
    if (dev?.readdir) return await dev.readdir();
    if (this.isKnownPath(path))
      throw new Error(`ENOTDIR: ${path} is not a directory`);
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
    throw new Error('EROFS: cannot rename in virtualfs');
  }

  async chmod(path: string, _mode: number): Promise<void> {
    throw new Error(`EROFS: cannot chmod '${path}': read-only`);
  }

  async chown(_path: string, _owner: number): Promise<void> {
    throw new Error('EROFS: cannot chown');
  }
}
