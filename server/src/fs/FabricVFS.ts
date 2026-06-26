/**
 * FabricVFS — 虚拟文件系统（mount 路由器）
 *
 * 将不同路径挂载到不同的 IFileSystem 实现。
 */

import { type IFileSystem, type FileStat } from './FileSystem';
import { DevFS } from './DevFS';
import type { VirtualDevice } from './DevFS';
import { type EventSocket } from './EventSocket';
import { Path } from './Path';

export class FabricVFS implements IFileSystem {
  private rootFs: IFileSystem | null = null;
  private devFs: DevFS | null = null;
  /* 后续 mount 点扩展用 Map */

  mount(prefix: string, fs: IFileSystem): void {
    if (prefix === '/') {
      this.rootFs = fs;
    } else if (prefix === '/dev') {
      this.devFs = fs as DevFS;
    }
  }

  /** 路由到对应 IFileSystem */
  private route(path: string): IFileSystem | null {
    if (path === '/dev' || path.startsWith('/dev/')) {
      return this.devFs;
    }
    return this.rootFs;
  }

  /** 获取所有非根挂载点路径 */
  private getMountPrefixes(): string[] {
    const prefixes: string[] = [];
    if (this.devFs) prefixes.push('/dev');
    return prefixes;
  }

  // ------------------------------------------------------------------
  //  便利方法
  // ------------------------------------------------------------------

  registerDevice(path: string, handler: VirtualDevice): void {
    const prefix = Path.parent(path);
    let fs = this.route(prefix);
    if (!fs) {
      const dev = new DevFS();
      this.mount(prefix, dev);
      fs = dev;
    }
    if (!(fs instanceof DevFS)) {
      throw new Error(
        `Cannot register device under '${prefix}': not a DevFS mount`
      );
    }
    (fs as DevFS).registerDevice(path, handler);
  }

  registerSocket(path: string): EventSocket {
    const prefix = Path.parent(path);
    let fs = this.route(prefix);
    if (!fs) {
      const dev = new DevFS();
      this.mount(prefix, dev);
      fs = dev;
    }
    if (!(fs instanceof DevFS)) {
      throw new Error(
        `Cannot register socket under '${prefix}': not a DevFS mount`
      );
    }
    return (fs as DevFS).registerSocket(path);
  }

  // ------------------------------------------------------------------
  //  IFileSystem
  // ------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.rootFs) await this.rootFs.init();
    if (this.devFs) await this.devFs.init();
  }

  async exists(path: string): Promise<boolean> {
    const fs = this.route(path);
    return fs ? fs.exists(path) : false;
  }

  async stat(path: string): Promise<FileStat | null> {
    const fs = this.route(path);
    return fs ? fs.stat(path) : null;
  }

  async readFile(path: string): Promise<string | null> {
    const fs = this.route(path);
    return fs ? fs.readFile(path) : null;
  }

  async writeFile(path: string, data: string): Promise<void> {
    const fs = this.route(path);
    if (!fs) throw new Error(`ENOENT: ${path}`);
    return fs.writeFile(path, data);
  }

  async mkdir(path: string): Promise<void> {
    const fs = this.route(path);
    if (!fs) throw new Error(`ENOENT: ${path}`);
    return fs.mkdir(path);
  }

  async readdir(path: string): Promise<string[]> {
    const fs = this.route(path);
    if (!fs) throw new Error(`ENOENT: ${path}`);
    const names = await fs.readdir(path);

    // 补充 mount 点的第一段路径（dev、run…）
    for (const prefix of this.getMountPrefixes()) {
      const firstSeg = Path.basename(prefix);
      if (path === '/' && firstSeg && !names.includes(firstSeg)) {
        names.push(firstSeg);
      }
    }
    return names.sort();
  }

  async unlink(path: string): Promise<void> {
    const fs = this.route(path);
    if (!fs) throw new Error(`ENOENT: ${path}`);
    return fs.unlink(path);
  }

  async rmdir(path: string): Promise<void> {
    const fs = this.route(path);
    if (!fs) throw new Error(`ENOENT: ${path}`);
    return fs.rmdir(path);
  }

  async rimraf(path: string): Promise<void> {
    const fs = this.route(path);
    if (!fs) return;
    return fs.rimraf(path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const fs = this.route(oldPath);
    if (!fs) throw new Error(`ENOENT: ${oldPath}`);
    return fs.rename(oldPath, newPath);
  }

  async chmod(path: string, mode: number): Promise<void> {
    const fs = this.route(path);
    if (!fs) throw new Error(`ENOENT: ${path}`);
    return fs.chmod(path, mode);
  }
}
