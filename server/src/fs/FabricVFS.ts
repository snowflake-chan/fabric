/**
 * FabricVFS — 虚拟文件系统层
 *
 * 职责：
 *   在 FabricFS 之上提供路径级操作（stat/readFile/writeFile/...）、
 *   路径解析（resolve/resolveParent）和虚拟设备文件（/dev/null）。
 *
 *   非虚拟路径的操作委托给底层的 FabricFS。
 *
 * Shell/Cli 通过 IFileSystem 接口与 FabricVFS 交互，
 * 不直接感知底层存储实现。
 */

import { type IFileSystem, type FileStat, type INode } from './FileSystem';
import type { FabricFS } from './FileSystem';
import { CHUNK_SIZE } from './FileSystem';

// ---- 虚拟设备注册接口 ------------------------------------------------------

/**
 * 虚拟设备/文件的处理器。
 * 实现其中一部分方法，FabricVFS 会自动处理其余操作的默认行为（EROFS、ENOENT 等）。
 */
export interface VirtualDevice {
  /** 返回 stat 信息，默认返回 type=file mode=0o444 size=0 */
  stat?: () => FileStat | Promise<FileStat>;
  /** 读取文件内容，默认返回 null（ENOENT） */
  readFile?: () => string | null | Promise<string | null>;
  /** 写入文件内容，默认抛 EROFS */
  writeFile?: (data: string) => void | Promise<void>;
  /** 列出目录内容，仅对虚拟目录有效 */
  readdir?: () => string[] | Promise<string[]>;
  /** 挂载的子设备（仅对目录有效） */
  children?: Record<string, VirtualDevice>;
}

// ---- FabricVFS ------------------------------------------------------------

export class FabricVFS implements IFileSystem {
  /** 已注册的虚拟设备表 */
  private devices = new Map<string, VirtualDevice>();

  constructor(private fs: FabricFS) {}

  /**
   * 注册一个虚拟设备/文件。
   * path 必须以 /dev/ 开头，例如 registerDevice('/dev/zero', handler)。
   */
  registerDevice(path: string, handler: VirtualDevice): void {
    this.devices.set(path, handler);
    // 确保父目录存在：/dev/foo → /dev 自动建
    const parent = path.substring(0, path.lastIndexOf('/'));
    if (parent && parent !== path) {
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
            return kids;
          },
        });
      }
    }
  }

  /** 查找虚拟设备（精确匹配，再尝试父目录） */
  private getDevice(path: string): VirtualDevice | undefined {
    return this.devices.get(path);
  }

  // ------------------------------------------------------------------
  //  内置设备注册
  // ------------------------------------------------------------------

  /** 注册内置虚拟设备（/dev/null 等） */
  private registerBuiltin(): void {
    this.registerDevice('/dev', {
      readdir: () => {
        const kids: string[] = [];
        for (const k of this.devices.keys()) {
          if (k.startsWith('/dev/') && k !== '/dev') {
            const name = k.substring(5);
            if (!name.includes('/')) kids.push(name);
          }
        }
        return kids;
      },
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
    });

    this.registerDevice('/dev/null', {
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
  }

  // ------------------------------------------------------------------
  //  初始化
  // ------------------------------------------------------------------

  async init(): Promise<void> {
    await this.fs.init();
    this.registerBuiltin();
  }

  // ------------------------------------------------------------------
  //  路径解析
  // ------------------------------------------------------------------

  /** 标准化路径 → segments。空数组表示根目录。 */
  private splitPath(path: string): string[] {
    if (!path.startsWith('/')) {
      throw new Error(`Only absolute paths are supported: ${path}`);
    }
    return path.split('/').filter(Boolean);
  }

  /** 解析路径到 inode ID，不存在返回 null */
  private async resolve(path: string): Promise<number | null> {
    const parts = this.splitPath(path);
    if (parts.length === 0) return (await this.fs.getMeta()).rootInode;

    const meta = await this.fs.getMeta();
    let inodeId = meta.rootInode;

    for (const part of parts) {
      const entries = await this.fs.getDirEntries(inodeId);
      const entry = entries.find((e) => e.name === part);
      if (!entry) return null;
      inodeId = entry.inode;
    }
    return inodeId;
  }

  /** 解析父目录，供 mkdir / writeFile / unlink / rmdir 使用 */
  private async resolveParent(
    path: string
  ): Promise<{ parentId: number; name: string }> {
    const parts = this.splitPath(path);
    if (parts.length === 0) {
      throw new Error('Cannot operate on root directory');
    }

    const name = parts[parts.length - 1];
    const parentPath = `/${parts.slice(0, -1).join('/')}`;
    const parentId = await this.resolve(parentPath);
    if (parentId === null) {
      throw new Error(`ENOENT: parent directory not found: ${parentPath}`);
    }

    // 确认父节点是目录
    const parentInode = await this.fs.getINode(parentId);
    if (parentInode.type !== 'dir') {
      throw new Error(`ENOTDIR: ${parentPath} is not a directory`);
    }

    return { parentId, name };
  }

  /** 检查路径是虚拟设备 */
  private isDevicePath(path: string): boolean {
    for (const k of this.devices.keys()) {
      if (path === k || path.startsWith(`${k}/`)) return true;
    }
    return false;
  }

  /** 虚拟设备不可写时抛 EROFS */
  private async checkReadonly(path: string): Promise<void> {
    const dev = this.getDevice(path);
    if (!dev) return;
    // 有 writeFile 实现 → 可写；否则只读
    if (!dev.writeFile) {
      throw new Error(`EROFS: cannot modify '${path}': read-only`);
    }
  }

  // ------------------------------------------------------------------
  //  IFileSystem
  // ------------------------------------------------------------------

  async exists(path: string): Promise<boolean> {
    if (this.getDevice(path)) return true;
    if (this.isDevicePath(path)) return false;
    return (await this.resolve(path)) !== null;
  }

  async stat(path: string): Promise<FileStat | null> {
    const dev = this.getDevice(path);
    if (dev?.stat) return await dev.stat();
    if (this.isDevicePath(path)) return null;

    const id = await this.resolve(path);
    if (id === null) return null;
    const inode = await this.fs.getINode(id);
    return {
      type: inode.type,
      mode: inode.mode,
      size: inode.size,
      uid: inode.uid,
      gid: inode.gid,
      atime: inode.atime,
      mtime: inode.mtime,
      ctime: inode.ctime,
      nlinks: inode.nlinks,
    };
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.checkReadonly(path);
    const id = await this.resolve(path);
    if (id === null) throw new Error(`ENOENT: ${path} not found`);

    const inode = await this.fs.getINode(id);
    inode.mode = mode;
    inode.ctime = Date.now();
    await this.fs.setINode(id, inode);
  }

  async readFile(path: string): Promise<string | null> {
    const dev = this.getDevice(path);
    if (dev?.readFile) return await dev.readFile();
    if (this.isDevicePath(path)) return null;

    const id = await this.resolve(path);
    if (id === null) return null;
    const inode = await this.fs.getINode(id);
    if (inode.type !== 'file')
      throw new Error(`EISDIR: ${path} is a directory`);

    // 更新 atime
    inode.atime = Date.now();
    await this.fs.setINode(id, inode);

    // 分块模式 → 拼合所有分块
    if (inode.chunkCount) {
      return await this.fs.readChunks(id, inode.chunkCount);
    }

    // inline 模式
    return inode.data ?? '';
  }

  async writeFile(path: string, data: string): Promise<void> {
    const dev = this.getDevice(path);
    if (dev?.writeFile) {
      await dev.writeFile(data);
      return;
    }
    if (this.isDevicePath(path)) {
      throw new Error(`EROFS: cannot write '${path}': read-only`);
    }

    const { parentId, name } = await this.resolveParent(path);

    // 决定存储模式
    const useChunked = data.length > CHUNK_SIZE;

    // 先检查文件是否已存在（非原子，仅用于区分创建 / 更新路径）
    const entries = await this.fs.getDirEntries(parentId);
    const existing = entries.find((e) => e.name === name);

    if (existing) {
      // ── 更新已有文件 ──
      const inode = await this.fs.getINode(existing.inode);
      if (inode.type !== 'file') {
        throw new Error(`EISDIR: ${path} is a directory`);
      }
      const id = existing.inode;

      // 清除旧存储
      if (inode.chunkCount) {
        await this.fs.clearChunks(id, inode.chunkCount);
      }
      inode.data = undefined;
      inode.chunkCount = undefined;

      // 写入新数据
      if (useChunked) {
        inode.chunkCount = await this.fs.writeChunked(id, data);
      } else {
        inode.data = data;
      }
      inode.size = data.length;
      inode.mtime = Date.now();
      inode.ctime = Date.now();
      await this.fs.setINode(id, inode);
    } else {
      // ── 创建新文件 ──
      const id = await this.fs.allocInode();
      const now = Date.now();

      // 先写数据，再写 inode
      if (useChunked) {
        const count = await this.fs.writeChunked(id, data);
        const inode: INode = {
          type: 'file',
          parent: parentId,
          mode: 0o644,
          uid: 0,
          gid: 0,
          size: data.length,
          atime: now,
          mtime: now,
          ctime: now,
          nlinks: 1,
          chunkCount: count,
        };
        await this.fs.setINode(id, inode);
      } else {
        const inode: INode = {
          type: 'file',
          parent: parentId,
          mode: 0o644,
          uid: 0,
          gid: 0,
          size: data.length,
          atime: now,
          mtime: now,
          ctime: now,
          nlinks: 1,
          data,
        };
        await this.fs.setINode(id, inode);
      }

      // 原子地添加到父目录（处理并发的同名创建）
      await this.fs.updateDirEntries(parentId, (cur) => {
        const dup = cur.findIndex((e) => e.name === name);
        if (dup !== -1) {
          cur[dup] = { name, inode: id };
        } else {
          cur.push({ name, inode: id });
        }
        return cur;
      });
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.checkReadonly(path);
    const { parentId, name } = await this.resolveParent(path);

    // 检查是否已存在
    const existsId = await this.resolve(path);
    if (existsId !== null) throw new Error(`EEXIST: ${path} already exists`);

    const dirId = await this.fs.allocInode();
    const now = Date.now();
    const inode: INode = {
      type: 'dir',
      parent: parentId,
      mode: 0o755,
      uid: 0,
      gid: 0,
      size: 0,
      atime: now,
      mtime: now,
      ctime: now,
      nlinks: 2,
    };
    await this.fs.setINode(dirId, inode);
    await this.fs.setDirEntries(dirId, []);

    // 原子地添加到父目录
    await this.fs.updateDirEntries(parentId, (cur) => {
      cur.push({ name, inode: dirId });
      return cur;
    });
  }

  async readdir(path: string): Promise<string[]> {
    const dev = this.getDevice(path);
    if (dev?.readdir) return await dev.readdir();
    if (this.isDevicePath(path)) {
      throw new Error(`ENOTDIR: ${path} is not a directory`);
    }

    const id = await this.resolve(path);
    if (id === null) throw new Error(`ENOENT: ${path} not found`);

    const inode = await this.fs.getINode(id);
    if (inode.type !== 'dir') {
      throw new Error(`ENOTDIR: ${path} is not a directory`);
    }

    const entries = await this.fs.getDirEntries(id);
    return entries.map((e) => e.name);
  }

  async unlink(path: string): Promise<void> {
    await this.checkReadonly(path);
    const { parentId, name } = await this.resolveParent(path);

    // 先 look up 文件 inode ID，以便后续清理分块
    const before = await this.fs.getDirEntries(parentId);
    const first = before.find((e) => e.name === name);

    // 从父目录移除所有同名条目（防止幽灵文件）
    await this.fs.updateDirEntries(parentId, (cur) => {
      const filtered = cur.filter((e) => e.name !== name);
      if (filtered.length === cur.length)
        throw new Error(`ENOENT: ${path} not found`);
      return filtered;
    });

    // 清理文件分块与 inode
    if (first) {
      try {
        const inode = await this.fs.getINode(first.inode);
        if (inode.chunkCount) {
          await this.fs.clearChunks(first.inode, inode.chunkCount);
        }
      } catch {
        // inode 可能已被其他操作删除，忽略
      }
      await this.fs.freeInode(first.inode);
    }
  }

  async rmdir(path: string): Promise<void> {
    await this.checkReadonly(path);
    const id = await this.resolve(path);
    if (id === null) throw new Error(`ENOENT: ${path} not found`);

    const inode = await this.fs.getINode(id);
    if (inode.type !== 'dir') {
      throw new Error(`ENOTDIR: ${path} is not a directory`);
    }

    const entries = await this.fs.getDirEntries(id);
    if (entries.length > 0) {
      throw new Error(`ENOTEMPTY: ${path} is not empty`);
    }

    const { parentId, name } = await this.resolveParent(path);
    await this.fs.updateDirEntries(parentId, (cur) => {
      const filtered = cur.filter((e) => e.name !== name);
      if (filtered.length === cur.length)
        throw new Error(`ENOENT: ${path} not found`);
      return filtered;
    });
    // 清理目录条目 KV 并回收 inode
    try {
      await this.fs.removeDirEntries(id);
    } catch {
      // 可能已被清理，忽略
    }
    await this.fs.freeInode(id);
  }

  async rimraf(path: string): Promise<void> {
    await this.checkReadonly(path);
    if (path === '/') return; // 根目录不可删除

    const id = await this.resolve(path);
    if (id === null) return; // ENOENT → 静默忽略（类似 rm -f）

    const inode = await this.fs.getINode(id);

    if (inode.type === 'file') {
      // 清理文件分块
      if (inode.chunkCount) {
        await this.fs.clearChunks(id, inode.chunkCount);
      }
      // 从父目录移除（删所有同名条目，防幽灵）
      const { parentId, name } = await this.resolveParent(path);
      await this.fs.updateDirEntries(parentId, (cur) => {
        return cur.filter((e) => e.name !== name);
      });
      await this.fs.freeInode(id);
      return;
    }

    // 目录：先递归删除子项
    const entries = await this.fs.getDirEntries(id);
    for (const entry of entries) {
      const childPath =
        path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
      await this.rimraf(childPath);
    }

    // 清理目录条目 KV
    try {
      await this.fs.removeDirEntries(id);
    } catch {
      // 可能已被清理，忽略
    }

    // 从父目录移除自身（删所有同名条目，防幽灵）
    const { parentId, name } = await this.resolveParent(path);
    await this.fs.updateDirEntries(parentId, (cur) => {
      return cur.filter((e) => e.name !== name);
    });
    await this.fs.freeInode(id);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.checkReadonly(oldPath);
    await this.checkReadonly(newPath);

    const srcId = await this.resolve(oldPath);
    if (srcId === null) throw new Error(`ENOENT: ${oldPath} not found`);

    const { parentId: oldParentId, name: oldName } =
      await this.resolveParent(oldPath);
    const { parentId: newParentId, name: newName } =
      await this.resolveParent(newPath);

    // 同一位置 → 无操作
    if (oldParentId === newParentId && oldName === newName) return;

    // 检查目标是否已存在
    const targetId = await this.resolve(newPath);
    if (targetId !== null) {
      const targetInode = await this.fs.getINode(targetId);
      if (targetInode.type === 'dir') {
        const entries = await this.fs.getDirEntries(targetId);
        if (entries.length > 0) {
          throw new Error(`ENOTEMPTY: ${newPath} is not empty`);
        }
      }
    }

    if (oldParentId === newParentId) {
      // ── 同目录改名 ──
      await this.fs.updateDirEntries(oldParentId, (cur) => {
        const entries = [...cur];
        const filtered = entries.filter((e) => e.name !== oldName);
        const idx = filtered.findIndex((e) => e.name === newName);
        if (idx !== -1) {
          filtered[idx] = { name: newName, inode: srcId };
        } else {
          filtered.push({ name: newName, inode: srcId });
        }
        return filtered;
      });
    } else {
      // ── 跨目录移动 ──
      // Step 1: 写入新目录
      await this.fs.updateDirEntries(newParentId, (cur) => {
        const entries = [...cur];
        const idx = entries.findIndex((e) => e.name === newName);
        if (idx !== -1) {
          entries[idx] = { name: newName, inode: srcId };
        } else {
          entries.push({ name: newName, inode: srcId });
        }
        return entries;
      });

      // Step 2: 从旧目录删除
      await this.fs.updateDirEntries(oldParentId, (cur) => {
        const entries = [...cur];
        const idx = entries.findIndex((e) => e.inode === srcId);
        if (idx !== -1) entries.splice(idx, 1);
        return entries;
      });

      // Step 3: 更新 source 的 parent 指针
      const srcInode = await this.fs.getINode(srcId);
      srcInode.parent = newParentId;
      srcInode.ctime = Date.now();
      await this.fs.setINode(srcId, srcInode);
    }
  }
}
