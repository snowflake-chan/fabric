/**
 * FabricVFS — 虚拟文件系统（mount 路由器）
 *
 * 将不同路径挂载到不同的 IFileSystem 实现。
 * 路由时会剥离 mount 前缀，使子 FS 路径始终以 / 开头。
 */

import { type IFileSystem, type FileStat } from './FileSystem';
import { DevFS } from './DevFS';
import type { VirtualDevice } from './DevFS';
import { EventBus } from './EventBus';
import { type EventSocket } from './EventSocket';
import { Path } from './Path';

interface RouteResult {
  fs: IFileSystem;
  /** 剥离 mount 前缀后的内部路径 */
  inner: string;
}

export class FabricVFS implements IFileSystem {
  private mounts = new Map<string, IFileSystem>();
  private rootFs: IFileSystem | null = null;
  /** 共享事件总线（同进程内所有模块可见） */
  bus = new EventBus();

  mount(prefix: string, fs: IFileSystem): void {
    if (prefix === '/') {
      this.rootFs = fs;
    } else {
      this.mounts.set(prefix, fs);
    }
  }

  /** 路由并翻译路径 — 统一剥离 mount 前缀 */
  private resolve(path: string): RouteResult | null {
    for (const [prefix, fs] of this.mounts) {
      if (path === prefix) return { fs, inner: '/' };
      if (path.startsWith(`${prefix}/`)) {
        return { fs, inner: path.slice(prefix.length) };
      }
    }
    if (this.rootFs) return { fs: this.rootFs, inner: path };
    return null;
  }

  /** 获取所有非根挂载点路径 */
  private getMountPrefixes(): string[] {
    return Array.from(this.mounts.keys()).sort();
  }

  /** 获取挂载信息 */
  getMounts(): Array<{ prefix: string; type: string }> {
    const result: Array<{ prefix: string; type: string }> = [];
    result.push({ prefix: '/', type: 'rootfs' });
    for (const [prefix, fs] of this.mounts) {
      const type = fs instanceof DevFS ? 'devfs' : 'rootfs';
      result.push({ prefix, type });
    }
    return result;
  }

  /** 卸载指定路径 */
  unmount(prefix: string): void {
    this.mounts.delete(prefix);
  }

  /** 获取路径所在的 IFileSystem */
  getFs(path: string): IFileSystem | null {
    const r = this.resolve(path);
    return r ? r.fs : null;
  }

  // ------------------------------------------------------------------
  //  便利方法
  // ------------------------------------------------------------------

  registerDevice(path: string, handler: VirtualDevice): void {
    const prefix = Path.parent(path);
    const r = this.resolve(prefix);
    if (!r || !(r.fs instanceof DevFS)) {
      const dev = new DevFS(this.bus);
      this.mount(prefix, dev);
      dev.registerDevice(path, handler);
      return;
    }
    (r.fs as DevFS).registerDevice(path, handler);
  }

  registerSocket(path: string): EventSocket {
    const prefix = Path.parent(path);
    const r = this.resolve(prefix);
    if (!r || !(r.fs instanceof DevFS)) {
      const dev = new DevFS(this.bus);
      this.mount(prefix, dev);
      return dev.registerSocket(path);
    }
    return (r.fs as DevFS).registerSocket(path);
  }

  // ------------------------------------------------------------------
  //  IFileSystem
  // ------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.rootFs) await this.rootFs.init();
    for (const fs of this.mounts.values()) {
      await fs.init();
    }
  }

  async format(): Promise<void> {
    if (this.rootFs) await this.rootFs.format();
    for (const fs of this.mounts.values()) {
      await fs.format();
    }
  }

  async exists(path: string): Promise<boolean> {
    const r = this.resolve(path);
    return r ? r.fs.exists(r.inner) : false;
  }

  async stat(path: string): Promise<FileStat | null> {
    // 精确匹配挂载点 → 委托到其根
    const mountFs = this.mounts.get(path);
    if (mountFs) return mountFs.stat('/');

    // 虚拟父目录（如 /mnt）
    for (const mp of this.getMountPrefixes()) {
      if (path === Path.parent(mp) && path !== '/') {
        return {
          type: 'dir',
          mode: 0o755,
          size: 0,
          uid: 0,
          gid: 0,
          atime: 0,
          mtime: 0,
          ctime: 0,
          nlinks: 2,
        };
      }
    }

    const r = this.resolve(path);
    return r ? r.fs.stat(r.inner) : null;
  }

  async readFile(path: string): Promise<string | null> {
    const r = this.resolve(path);
    return r ? r.fs.readFile(r.inner) : null;
  }

  async writeFile(path: string, data: string): Promise<void> {
    const r = this.resolve(path);
    if (!r) throw new Error(`ENOENT: ${path}`);
    return r.fs.writeFile(r.inner, data);
  }

  async mkdir(path: string): Promise<void> {
    const r = this.resolve(path);
    if (!r) throw new Error(`ENOENT: ${path}`);
    return r.fs.mkdir(r.inner);
  }

  async readdir(path: string): Promise<string[]> {
    // 精确匹配挂载点 → 委托到其根
    const mountFs = this.mounts.get(path);
    if (mountFs) return mountFs.readdir('/');

    const r = this.resolve(path);

    // 底层 FS 能处理 → 用它的结果 + 补充挂载子路径
    if (r) {
      try {
        const names = await r.fs.readdir(r.inner);
        const prefix = path === '/' ? '' : path;
        for (const mp of this.getMountPrefixes()) {
          if (mp === prefix) continue;
          if (mp.startsWith(`${prefix}/`)) {
            const seg = mp.slice(prefix.length + 1).split('/')[0];
            if (seg && !names.includes(seg)) names.push(seg);
          }
        }
        return names.sort();
      } catch {
        // ENOENT → 可能是 mount 点的虚拟父目录
      }
    }

    // 从挂载前缀构造虚拟目录
    const prefix = path === '/' ? '' : path;
    const kids: string[] = [];
    for (const mp of this.getMountPrefixes()) {
      if (mp === prefix) continue;
      if (mp.startsWith(`${prefix}/`)) {
        const seg = mp.slice(prefix.length + 1).split('/')[0];
        if (seg && !kids.includes(seg)) kids.push(seg);
      }
    }
    if (kids.length > 0) return kids.sort();

    if (!r) throw new Error(`ENOENT: ${path}`);
    throw new Error(`ENOENT: ${path}`);
  }

  async unlink(path: string): Promise<void> {
    const r = this.resolve(path);
    if (!r) throw new Error(`ENOENT: ${path}`);
    return r.fs.unlink(r.inner);
  }

  async rmdir(path: string): Promise<void> {
    const r = this.resolve(path);
    if (!r) throw new Error(`ENOENT: ${path}`);
    return r.fs.rmdir(r.inner);
  }

  async rimraf(path: string): Promise<void> {
    const r = this.resolve(path);
    if (!r) return;
    return r.fs.rimraf(r.inner);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const r = this.resolve(oldPath);
    if (!r) throw new Error(`ENOENT: ${oldPath}`);
    const r2 = this.resolve(newPath);
    if (!r2) throw new Error(`ENOENT: ${newPath}`);
    if (r.fs !== r2.fs)
      throw new Error('EXDEV: cross-filesystem rename not supported');
    return r.fs.rename(r.inner, r2.inner);
  }

  async chmod(path: string, mode: number): Promise<void> {
    const r = this.resolve(path);
    if (!r) throw new Error(`ENOENT: ${path}`);
    return r.fs.chmod(r.inner, mode);
  }
}
