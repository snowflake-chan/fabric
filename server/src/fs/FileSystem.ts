/**
 * FabricFS — 基于 GameDataStorage KV 的仿 Linux 文件系统
 *
 * 设计概要：
 *   V          →  { rootInode, nextInode }              超块 / 元信息
 *   I:{id}     →  { type, mode, size, ... data?,
 *                    chunkCount? }                       inode
 *   D:{id}     →  [{ name, inode }, ...]                目录条目聚合
 *   C:{id}:{n} →  第 n 个数据分块                       chunk（仅大文件）
 *
 * 策略：
 *   - 目录条目全量聚合（方案 A）
 *   - 文件 < 64 KB  →  inline 存 inode.data
 *   - 文件 ≥ 64 KB  →  分块存 C:{id}:{n}，每块 64 KB
 *   - 分块以 string 形式存储，二进制需外部先 base64
 */

// ---- 内部类型 ------------------------------------------------------------

interface FSMeta {
  rootInode: number;
  nextInode: number;
}

interface INode {
  type: 'file' | 'dir';
  /** 父目录 inode ID。根目录为 0。 */
  parent: number;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  atime: number;
  mtime: number;
  ctime: number;
  nlinks: number;
  /** 文件内容：inline 模式，空字符串或缺失视为空文件 */
  data?: string;
  /**
   * 文件内容：分块模式。
   * 存在此字段表示文件内容以分块形式存储，
   * 每块 CHUNK_SIZE（64 KB），块 key 为 C:{id}:{n}。
   * inline 模式和分块模式互斥。
   */
  chunkCount?: number;
}

interface DirEntry {
  name: string;
  inode: number;
}

// ---- 公开类型 ------------------------------------------------------------

export interface FileStat {
  type: 'file' | 'dir';
  mode: number;
  size: number;
  uid: number;
  gid: number;
  atime: number;
  mtime: number;
  ctime: number;
  nlinks: number;
}

// ---- KV key 常量 ----------------------------------------------------------

const ROOT_INODE = 1;
/** 分块阈值 / 分块大小：64 KB */
const CHUNK_SIZE = 65536;
const K_META = 'V';
const K_INODE = (id: number) => `I:${id}`;
const K_DIR = (id: number) => `D:${id}`;
const K_CHUNK = (id: number, n: number) => `C:${id}:${n}`;

// ---- FabricFS -------------------------------------------------------------

export class FabricFS {
  private metaCache: FSMeta | null = null;

  /**
   * @param storage 用户传入的 GameDataStorage 实例，例如：
   *                `storage.getDataStorage('fabric_fs')`
   */
  constructor(private storage: GameDataStorage<JSONValue>) {}

  // ------------------------------------------------------------------
  //  初始化
  // ------------------------------------------------------------------

  /**
   * 初始化文件系统。首次调用会在 KV 中创建根目录；
   * 后续调用检测到元信息已存在则直接返回。
   */
  async init(): Promise<void> {
    const raw = await this.storage.get(K_META);
    if (raw) {
      this.metaCache = raw.value as unknown as FSMeta;
      return;
    }

    const meta: FSMeta = { rootInode: ROOT_INODE, nextInode: ROOT_INODE + 1 };
    await this.storage.set(K_META, meta as unknown as JSONValue);

    const rootInode: INode = {
      type: 'dir',
      parent: 0,
      mode: 0o755,
      uid: 0,
      gid: 0,
      size: 0,
      atime: Date.now(),
      mtime: Date.now(),
      ctime: Date.now(),
      nlinks: 2,
    };
    await this.storage.set(
      K_INODE(ROOT_INODE),
      rootInode as unknown as JSONValue
    );
    await this.storage.set(K_DIR(ROOT_INODE), [] as JSONValue);

    this.metaCache = meta;
  }

  // ------------------------------------------------------------------
  //  内部工具
  // ------------------------------------------------------------------

  /** 读取元信息（带缓存） */
  private async getMeta(): Promise<FSMeta> {
    if (this.metaCache) return this.metaCache;
    const raw = await this.storage.get(K_META);
    if (!raw) throw new Error('FabricFS not initialized – call init() first');
    this.metaCache = raw.value as unknown as FSMeta;
    return this.metaCache;
  }

  /** 使元信息缓存失效（allocInode 后调用） */
  private invalidateMeta(): void {
    this.metaCache = null;
  }

  /** 原子分配一个新的 inode ID */
  private async allocInode(): Promise<number> {
    let id = 0;
    await this.storage.update(K_META, (prev) => {
      const meta: FSMeta = prev?.value
        ? (prev.value as unknown as FSMeta)
        : { rootInode: ROOT_INODE, nextInode: ROOT_INODE + 1 };
      id = meta.nextInode++;
      return meta as unknown as JSONValue;
    });
    this.invalidateMeta();
    return id;
  }

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
    if (parts.length === 0) return (await this.getMeta()).rootInode;

    const meta = await this.getMeta();
    let inodeId = meta.rootInode;

    for (const part of parts) {
      const raw = await this.storage.get(K_DIR(inodeId));
      if (!raw) return null;
      const entries = raw.value as unknown as DirEntry[];
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
    const parentRaw = await this.storage.get(K_INODE(parentId));
    if (!parentRaw) {
      throw new Error('FabricFS internal: parent inode not found');
    }
    if ((parentRaw.value as unknown as INode).type !== 'dir') {
      throw new Error(`ENOTDIR: ${parentPath} is not a directory`);
    }

    return { parentId, name };
  }

  /** 快捷读取 inode */
  private async getINode(id: number): Promise<INode> {
    const raw = await this.storage.get(K_INODE(id));
    if (!raw) throw new Error('FabricFS internal: inode not found');
    return raw.value as unknown as INode;
  }

  /** 快捷写入 inode */
  private async setINode(id: number, inode: INode): Promise<void> {
    await this.storage.set(K_INODE(id), inode as unknown as JSONValue);
  }

  /** 快捷读取目录条目 */
  private async getDirEntries(id: number): Promise<DirEntry[]> {
    const raw = await this.storage.get(K_DIR(id));
    return raw ? (raw.value as unknown as DirEntry[]) : [];
  }

  // ---- 分块读写工具 -------------------------------------------------------

  /** 从 KV 读取所有分块并拼回完整字符串 */
  private async readChunks(id: number, count: number): Promise<string> {
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const raw = await this.storage.get(K_CHUNK(id, i));
      if (!raw) {
        throw new Error(
          `FabricFS internal: chunk ${i}/${count} missing for inode ${id}`
        );
      }
      parts.push(raw.value as string);
    }
    return parts.join('');
  }

  /** 删除 inode 的所有分块 */
  private async clearChunks(id: number, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await this.storage.remove(K_CHUNK(id, i));
    }
  }

  /**
   * 将数据写入分块存储，返回分块数。
   * 调用前需确保旧分块已清除。
   */
  private async writeChunked(id: number, data: string): Promise<number> {
    const count = Math.ceil(data.length / CHUNK_SIZE);
    for (let i = 0; i < count; i++) {
      const chunk = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await this.storage.set(K_CHUNK(id, i), chunk as unknown as JSONValue);
    }
    return count;
  }

  // ------------------------------------------------------------------
  //  公开 API
  // ------------------------------------------------------------------

  /**
   * 判断路径是否存在（文件或目录均可）。
   */
  async exists(path: string): Promise<boolean> {
    return (await this.resolve(path)) !== null;
  }

  /**
   * 获取路径的元信息，不存在返回 null。
   */
  async stat(path: string): Promise<FileStat | null> {
    const id = await this.resolve(path);
    if (id === null) return null;
    const inode = await this.getINode(id);
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

  /**
   * 读取文件内容。
   * - 文件不存在返回 null
   * - 路径是目录则抛出 EISDIR
   */
  async readFile(path: string): Promise<string | null> {
    const id = await this.resolve(path);
    if (id === null) return null;
    const inode = await this.getINode(id);
    if (inode.type !== 'file')
      throw new Error(`EISDIR: ${path} is a directory`);

    // 更新 atime
    inode.atime = Date.now();
    await this.setINode(id, inode);

    // 分块模式 → 拼合所有分块
    if (inode.chunkCount) {
      return await this.readChunks(id, inode.chunkCount);
    }

    // inline 模式
    return inode.data ?? '';
  }

  /**
   * 写入文件（创建或覆盖）。
   * - 父目录不存在 → 抛 ENOENT
   * - 路径已存在且是目录 → 抛 EISDIR
   *
   * 创建文件时使用 update() CAS 防并发。
   */
  async writeFile(path: string, data: string): Promise<void> {
    const { parentId, name } = await this.resolveParent(path);

    // 决定存储模式
    const useChunked = data.length > CHUNK_SIZE;

    // 先检查文件是否已存在（非原子，仅用于区分创建 / 更新路径）
    const entries = await this.getDirEntries(parentId);
    const existing = entries.find((e) => e.name === name);

    if (existing) {
      // ── 更新已有文件 ──
      const inode = await this.getINode(existing.inode);
      if (inode.type !== 'file') {
        throw new Error(`EISDIR: ${path} is a directory`);
      }
      const id = existing.inode;

      // 清除旧存储
      if (inode.chunkCount) {
        await this.clearChunks(id, inode.chunkCount);
      }
      inode.data = undefined;
      inode.chunkCount = undefined;

      // 写入新数据
      if (useChunked) {
        inode.chunkCount = await this.writeChunked(id, data);
      } else {
        inode.data = data;
      }
      inode.size = data.length;
      inode.mtime = Date.now();
      inode.ctime = Date.now();
      await this.setINode(id, inode);
    } else {
      // ── 创建新文件 ──
      const id = await this.allocInode();
      const now = Date.now();

      // 先写数据，再写 inode（inode 写到 KV 时数据已就绪）
      if (useChunked) {
        const count = await this.writeChunked(id, data);
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
        await this.setINode(id, inode);
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
        await this.setINode(id, inode);
      }

      // 原子地添加到父目录（处理并发的同名创建）
      await this.storage.update(K_DIR(parentId), (prev) => {
        const cur: DirEntry[] = prev?.value
          ? (prev.value as unknown as DirEntry[])
          : [];
        const dup = cur.findIndex((e) => e.name === name);
        if (dup !== -1) {
          // 并发写入者先到了，覆盖它的条目指向我们的 inode
          cur[dup] = { name, inode: id };
        } else {
          cur.push({ name, inode: id });
        }
        return cur as unknown as JSONValue;
      });
    }
  }

  /**
   * 创建目录。
   * - 父目录不存在 → 抛 ENOENT
   * - 路径已存在 → 抛 EEXIST
   */
  async mkdir(path: string): Promise<void> {
    const { parentId, name } = await this.resolveParent(path);

    // 检查是否已存在
    const existsId = await this.resolve(path);
    if (existsId !== null) throw new Error(`EEXIST: ${path} already exists`);

    const dirId = await this.allocInode();
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
    await this.setINode(dirId, inode);
    await this.storage.set(K_DIR(dirId), [] as JSONValue);

    // 原子地添加到父目录
    await this.storage.update(K_DIR(parentId), (prev) => {
      const cur: DirEntry[] = prev?.value
        ? (prev.value as unknown as DirEntry[])
        : [];
      cur.push({ name, inode: dirId });
      return cur as unknown as JSONValue;
    });
  }

  /**
   * 列出目录内容。
   * - 路径不存在 → 抛 ENOENT
   * - 路径不是目录 → 抛 ENOTDIR
   */
  async readdir(path: string): Promise<string[]> {
    const id = await this.resolve(path);
    if (id === null) throw new Error(`ENOENT: ${path} not found`);

    const inode = await this.getINode(id);
    if (inode.type !== 'dir') {
      throw new Error(`ENOTDIR: ${path} is not a directory`);
    }

    const entries = await this.getDirEntries(id);
    return entries.map((e) => e.name);
  }

  /**
   * 删除文件。
   * - 路径不存在 → 抛 ENOENT
   */
  async unlink(path: string): Promise<void> {
    const { parentId, name } = await this.resolveParent(path);

    // 先 look up 文件 inode ID，以便后续清理分块
    const entries = await this.getDirEntries(parentId);
    const entry = entries.find((e) => e.name === name);

    // 从父目录移除条目（原子操作）
    await this.storage.update(K_DIR(parentId), (prev) => {
      if (!prev?.value) throw new Error(`ENOENT: ${path} not found`);
      const cur = prev.value as unknown as DirEntry[];
      const idx = cur.findIndex((e) => e.name === name);
      if (idx === -1) throw new Error(`ENOENT: ${path} not found`);
      cur.splice(idx, 1);
      return cur as unknown as JSONValue;
    });

    // 如果文件存在且有分块，清理它们
    if (entry) {
      try {
        const inode = await this.getINode(entry.inode);
        if (inode.chunkCount) {
          await this.clearChunks(entry.inode, inode.chunkCount);
        }
      } catch {
        // inode 可能已被其他操作删除，忽略
      }
    }
  }

  /**
   * 删除空目录。
   * - 路径不存在 → 抛 ENOENT
   * - 目录非空 → 抛 ENOTEMPTY
   */
  async rmdir(path: string): Promise<void> {
    const id = await this.resolve(path);
    if (id === null) throw new Error(`ENOENT: ${path} not found`);

    const inode = await this.getINode(id);
    if (inode.type !== 'dir') {
      throw new Error(`ENOTDIR: ${path} is not a directory`);
    }

    const entries = await this.getDirEntries(id);
    if (entries.length > 0) {
      throw new Error(`ENOTEMPTY: ${path} is not empty`);
    }

    const { parentId, name } = await this.resolveParent(path);
    await this.storage.update(K_DIR(parentId), (prev) => {
      if (!prev?.value) throw new Error(`ENOENT: ${path} not found`);
      const cur = prev.value as unknown as DirEntry[];
      const idx = cur.findIndex((e) => e.name === name);
      if (idx === -1) throw new Error(`ENOENT: ${path} not found`);
      cur.splice(idx, 1);
      return cur as unknown as JSONValue;
    });
  }

  /**
   * 重命名 / 移动文件或目录。
   *
   * - 源路径不存在 → 抛 ENOENT
   * - 目标路径已存在且是文件 → 覆盖
   * - 目标路径已存在且是目录 → 只允许空目录，替换之
   * - 跨目录移动时更新 inode 的 parent 指针
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
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
      const targetInode = await this.getINode(targetId);
      if (targetInode.type === 'dir') {
        const entries = await this.getDirEntries(targetId);
        if (entries.length > 0) {
          throw new Error(`ENOTEMPTY: ${newPath} is not empty`);
        }
      }
    }

    if (oldParentId === newParentId) {
      // ── 同目录改名 ──
      await this.storage.update(K_DIR(oldParentId), (prev) => {
        const entries = [...(prev!.value as unknown as DirEntry[])];
        // 删掉旧名
        const filtered = entries.filter((e) => e.name !== oldName);
        // 替换或追加新名
        const idx = filtered.findIndex((e) => e.name === newName);
        if (idx !== -1) {
          filtered[idx] = { name: newName, inode: srcId };
        } else {
          filtered.push({ name: newName, inode: srcId });
        }
        return filtered as unknown as JSONValue;
      });
    } else {
      // ── 跨目录移动 ──
      // Step 1: 写入新目录
      await this.storage.update(K_DIR(newParentId), (prev) => {
        const entries = prev?.value
          ? [...(prev.value as unknown as DirEntry[])]
          : [];
        const idx = entries.findIndex((e) => e.name === newName);
        if (idx !== -1) {
          entries[idx] = { name: newName, inode: srcId };
        } else {
          entries.push({ name: newName, inode: srcId });
        }
        return entries as unknown as JSONValue;
      });

      // Step 2: 从旧目录删除
      await this.storage.update(K_DIR(oldParentId), (prev) => {
        if (!prev?.value) {
          throw new Error('FabricFS internal: old parent not found');
        }
        const entries = prev.value as unknown as DirEntry[];
        const idx = entries.findIndex((e) => e.inode === srcId);
        if (idx !== -1) entries.splice(idx, 1);
        return entries as unknown as JSONValue;
      });

      // Step 3: 更新 source 的 parent 指针
      const srcInode = await this.getINode(srcId);
      srcInode.parent = newParentId;
      srcInode.ctime = Date.now();
      await this.setINode(srcId, srcInode);
    }
  }
}
