/**
 * RootFS — 基于 FabricFS 的根文件系统（实现 IFileSystem）
 *
 * 将 FabricFS 的低级 INode 操作包装为路径级操作，
 * 挂载到 FabricVFS 的 / 路径下使用。
 */

import {
  type IFileSystem,
  type FileStat,
  type INode,
  type FabricFS,
  CHUNK_SIZE,
} from './FileSystem';
import { Path } from './Path';

export class RootFS implements IFileSystem {
  constructor(private fs: FabricFS) {}

  async init(): Promise<void> {
    await this.fs.init();
  }

  // ---- 路径解析 ------------------------------------------------------------

  private async resolve(path: string): Promise<number | null> {
    const parts = Path.split(path);
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

  private async resolveParent(
    path: string
  ): Promise<{ parentId: number; name: string }> {
    if (path === '/') throw new Error('Cannot operate on root directory');

    const name = Path.basename(path);
    const parentPath = Path.parent(path);
    const parentId = await this.resolve(parentPath);
    if (parentId === null) {
      throw new Error(`ENOENT: parent directory not found: ${parentPath}`);
    }

    const parentInode = await this.fs.getINode(parentId);
    if (parentInode.type !== 'dir') {
      throw new Error(`ENOTDIR: ${parentPath} is not a directory`);
    }
    return { parentId, name };
  }

  // ---- IFileSystem ---------------------------------------------------------

  async exists(path: string): Promise<boolean> {
    return (await this.resolve(path)) !== null;
  }

  async stat(path: string): Promise<FileStat | null> {
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
    const id = await this.resolve(path);
    if (id === null) throw new Error(`ENOENT: ${path} not found`);
    const inode = await this.fs.getINode(id);
    inode.mode = mode;
    inode.ctime = Date.now();
    await this.fs.setINode(id, inode);
  }

  async readFile(path: string): Promise<string | null> {
    const id = await this.resolve(path);
    if (id === null) return null;
    const inode = await this.fs.getINode(id);
    if (inode.type !== 'file')
      throw new Error(`EISDIR: ${path} is a directory`);

    inode.atime = Date.now();
    await this.fs.setINode(id, inode);

    if (inode.chunkCount) return await this.fs.readChunks(id, inode.chunkCount);
    return inode.data ?? '';
  }

  async writeFile(path: string, data: string): Promise<void> {
    const { parentId, name } = await this.resolveParent(path);
    const useChunked = data.length > CHUNK_SIZE;
    const entries = await this.fs.getDirEntries(parentId);
    const existing = entries.find((e) => e.name === name);

    if (existing) {
      const inode = await this.fs.getINode(existing.inode);
      if (inode.type !== 'file')
        throw new Error(`EISDIR: ${path} is a directory`);
      const id = existing.inode;

      if (inode.chunkCount) await this.fs.clearChunks(id, inode.chunkCount);
      inode.data = undefined;
      inode.chunkCount = undefined;

      if (useChunked) inode.chunkCount = await this.fs.writeChunked(id, data);
      else inode.data = data;
      inode.size = data.length;
      inode.mtime = Date.now();
      inode.ctime = Date.now();
      await this.fs.setINode(id, inode);
    } else {
      const id = await this.fs.allocInode();
      const now = Date.now();

      if (useChunked) {
        const count = await this.fs.writeChunked(id, data);
        await this.fs.setINode(id, {
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
        });
      } else {
        await this.fs.setINode(id, {
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
        });
      }

      await this.fs.updateDirEntries(parentId, (cur) => {
        const dup = cur.findIndex((e) => e.name === name);
        if (dup !== -1) cur[dup] = { name, inode: id };
        else cur.push({ name, inode: id });
        return cur;
      });
    }
  }

  async mkdir(path: string): Promise<void> {
    const { parentId, name } = await this.resolveParent(path);
    const existsId = await this.resolve(path);
    if (existsId !== null) throw new Error(`EEXIST: ${path} already exists`);

    const dirId = await this.fs.allocInode();
    const now = Date.now();
    await this.fs.setINode(dirId, {
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
    });
    await this.fs.setDirEntries(dirId, []);
    await this.fs.updateDirEntries(parentId, (cur) => {
      cur.push({ name, inode: dirId });
      return cur;
    });
  }

  async readdir(path: string): Promise<string[]> {
    const id = await this.resolve(path);
    if (id === null) throw new Error(`ENOENT: ${path} not found`);
    const inode = await this.fs.getINode(id);
    if (inode.type !== 'dir')
      throw new Error(`ENOTDIR: ${path} is not a directory`);
    const entries = await this.fs.getDirEntries(id);
    return entries.map((e) => e.name);
  }

  async unlink(path: string): Promise<void> {
    const { parentId, name } = await this.resolveParent(path);
    const before = await this.fs.getDirEntries(parentId);
    const first = before.find((e) => e.name === name);

    await this.fs.updateDirEntries(parentId, (cur) => {
      const filtered = cur.filter((e) => e.name !== name);
      if (filtered.length === cur.length)
        throw new Error(`ENOENT: ${path} not found`);
      return filtered;
    });

    if (first) {
      try {
        const inode = await this.fs.getINode(first.inode);
        if (inode.chunkCount)
          await this.fs.clearChunks(first.inode, inode.chunkCount);
      } catch {
        /* ignore */
      }
      await this.fs.freeInode(first.inode);
    }
  }

  async rmdir(path: string): Promise<void> {
    const id = await this.resolve(path);
    if (id === null) throw new Error(`ENOENT: ${path} not found`);

    const inode = await this.fs.getINode(id);
    if (inode.type !== 'dir')
      throw new Error(`ENOTDIR: ${path} is not a directory`);

    const entries = await this.fs.getDirEntries(id);
    if (entries.length > 0) throw new Error(`ENOTEMPTY: ${path} is not empty`);

    const { parentId, name } = await this.resolveParent(path);
    await this.fs.updateDirEntries(parentId, (cur) => {
      const filtered = cur.filter((e) => e.name !== name);
      if (filtered.length === cur.length)
        throw new Error(`ENOENT: ${path} not found`);
      return filtered;
    });
    try {
      await this.fs.removeDirEntries(id);
    } catch {
      /* ignore */
    }
    await this.fs.freeInode(id);
  }

  async rimraf(path: string): Promise<void> {
    if (path === '/') return;
    const id = await this.resolve(path);
    if (id === null) return;

    const inode = await this.fs.getINode(id);

    if (inode.type === 'file') {
      if (inode.chunkCount) await this.fs.clearChunks(id, inode.chunkCount);
      const { parentId, name } = await this.resolveParent(path);
      await this.fs.updateDirEntries(parentId, (cur) =>
        cur.filter((e) => e.name !== name)
      );
      await this.fs.freeInode(id);
      return;
    }

    const childEntries = await this.fs.getDirEntries(id);
    for (const entry of childEntries) {
      const childPath =
        path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
      await this.rimraf(childPath);
    }

    try {
      await this.fs.removeDirEntries(id);
    } catch {
      /* ignore */
    }
    const { parentId, name } = await this.resolveParent(path);
    await this.fs.updateDirEntries(parentId, (cur) =>
      cur.filter((e) => e.name !== name)
    );
    await this.fs.freeInode(id);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const srcId = await this.resolve(oldPath);
    if (srcId === null) throw new Error(`ENOENT: ${oldPath} not found`);

    const { parentId: oldParentId, name: oldName } =
      await this.resolveParent(oldPath);
    const { parentId: newParentId, name: newName } =
      await this.resolveParent(newPath);

    if (oldParentId === newParentId && oldName === newName) return;

    const targetId = await this.resolve(newPath);
    if (targetId !== null) {
      const targetInode = await this.fs.getINode(targetId);
      if (targetInode.type === 'dir') {
        const childEntries = await this.fs.getDirEntries(targetId);
        if (childEntries.length > 0)
          throw new Error(`ENOTEMPTY: ${newPath} is not empty`);
      }
    }

    if (oldParentId === newParentId) {
      await this.fs.updateDirEntries(oldParentId, (cur) => {
        const f = cur.filter((e) => e.name !== oldName);
        const idx = f.findIndex((e) => e.name === newName);
        if (idx !== -1) f[idx] = { name: newName, inode: srcId };
        else f.push({ name: newName, inode: srcId });
        return f;
      });
    } else {
      await this.fs.updateDirEntries(newParentId, (cur) => {
        const e = [...cur];
        const idx = e.findIndex((en) => en.name === newName);
        if (idx !== -1) e[idx] = { name: newName, inode: srcId };
        else e.push({ name: newName, inode: srcId });
        return e;
      });
      await this.fs.updateDirEntries(oldParentId, (cur) => {
        const e = [...cur];
        const idx = e.findIndex((en) => en.inode === srcId);
        if (idx !== -1) e.splice(idx, 1);
        return e;
      });
      const srcInode = await this.fs.getINode(srcId);
      srcInode.parent = newParentId;
      srcInode.ctime = Date.now();
      await this.fs.setINode(srcId, srcInode);
    }
  }
}
