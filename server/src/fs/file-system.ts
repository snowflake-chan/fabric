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

// ---- 内部类型（FabricVFS 亦需引用）-------------------------------------------

export interface FSMeta {
  rootInode: number;
  nextInode: number;
  /** 已释放可复用的 inode ID 池 */
  freeInodes?: number[];
}

export interface INode {
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

export interface DirEntry {
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
export const CHUNK_SIZE = 65536;
const K_META = 'V';
const K_INODE = (id: number) => `I:${id}`;
const K_DIR = (id: number) => `D:${id}`;
const K_CHUNK = (id: number, n: number) => `C:${id}:${n}`;

// ---- VFS 接口（Shell/Cli 只认此接口）---------------------------------------

export interface IFileSystem {
  init(): Promise<void>;
  format(): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat | null>;
  chmod(path: string, mode: number): Promise<void>;
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
  rmdir(path: string): Promise<void>;
  rimraf(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

// ---- FabricFS：底层存储（INode / 目录条目 / 分块）--------------------------

export class FabricFS {
  private metaCache: FSMeta | null = null;
  private inodeCache = new Map<number, INode>();
  private dirCache = new Map<number, DirEntry[]>();

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
    this.inodeCache.set(ROOT_INODE, rootInode);
    this.dirCache.set(ROOT_INODE, []);

    this.metaCache = meta;
  }

  /**
   * 格式化（重置）文件系统。
   * 重建根目录，清除缓存。旧数据块在 KV 中成为孤儿，下次 allocInode 会覆盖。
   */
  async format(): Promise<void> {
    const meta: FSMeta = { rootInode: ROOT_INODE, nextInode: ROOT_INODE + 1 };
    await this.storage.set(K_META, meta as unknown as JSONValue);

    const now = Date.now();
    const rootInode: INode = {
      type: 'dir',
      parent: 0,
      mode: 0o755,
      uid: 0,
      gid: 0,
      size: 0,
      atime: now,
      mtime: now,
      ctime: now,
      nlinks: 2,
    };
    await this.storage.set(
      K_INODE(ROOT_INODE),
      rootInode as unknown as JSONValue
    );
    await this.storage.set(K_DIR(ROOT_INODE), [] as JSONValue);

    this.inodeCache.clear();
    this.dirCache.clear();
    this.metaCache = meta;
    this.inodeCache.set(ROOT_INODE, rootInode);
    this.dirCache.set(ROOT_INODE, []);
  }

  // ------------------------------------------------------------------
  //  内部工具
  // ------------------------------------------------------------------

  /** 读取元信息（带缓存） */
  async getMeta(): Promise<FSMeta> {
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
  async allocInode(): Promise<number> {
    let id = 0;
    await this.storage.update(K_META, (prev) => {
      const meta: FSMeta = prev?.value
        ? (prev.value as unknown as FSMeta)
        : { rootInode: ROOT_INODE, nextInode: ROOT_INODE + 1 };
      // 优先复用已释放的 inode
      if (meta.freeInodes && meta.freeInodes.length > 0) {
        id = meta.freeInodes.pop()!;
      } else {
        id = meta.nextInode++;
      }
      return meta as unknown as JSONValue;
    });
    this.invalidateMeta();
    return id;
  }

  /** 释放 inode：清理 KV 条目并回收编号 */
  async freeInode(id: number): Promise<void> {
    // 清理 inode 数据
    this.inodeCache.delete(id);
    this.dirCache.delete(id);
    try {
      await this.storage.remove(K_INODE(id));
    } catch {
      // 可能已被其他操作删除
    }
    // 回收编号到空闲池
    await this.storage.update(K_META, (prev) => {
      if (!prev?.value) return prev?.value as unknown as JSONValue;
      const meta = prev.value as unknown as FSMeta;
      if (!meta.freeInodes) meta.freeInodes = [];
      meta.freeInodes.push(id);
      return meta as unknown as JSONValue;
    });
    this.invalidateMeta();
  }

  /** 快捷读取 inode */
  async getINode(id: number): Promise<INode> {
    const cached = this.inodeCache.get(id);
    if (cached) return cached;
    const raw = await this.storage.get(K_INODE(id));
    if (!raw) throw new Error('FabricFS internal: inode not found');
    const inode = raw.value as unknown as INode;
    this.inodeCache.set(id, inode);
    return inode;
  }

  /** 快捷写入 inode */
  async setINode(id: number, inode: INode): Promise<void> {
    await this.storage.set(K_INODE(id), inode as unknown as JSONValue);
    this.inodeCache.set(id, inode);
  }

  /** 快捷读取目录条目 */
  async getDirEntries(id: number): Promise<DirEntry[]> {
    const cached = this.dirCache.get(id);
    if (cached) return cached;
    const raw = await this.storage.get(K_DIR(id));
    const entries = raw ? (raw.value as unknown as DirEntry[]) : [];
    this.dirCache.set(id, entries);
    return entries;
  }

  /** 写入目录条目 */
  async setDirEntries(id: number, entries: DirEntry[]): Promise<void> {
    await this.storage.set(K_DIR(id), entries as unknown as JSONValue);
    this.dirCache.set(id, entries);
  }

  /** 删除目录条目 KV 键 */
  async removeDirEntries(id: number): Promise<void> {
    this.dirCache.delete(id);
    await this.storage.remove(K_DIR(id));
  }

  /** CAS 更新目录条目 */
  async updateDirEntries(
    id: number,
    updater: (entries: DirEntry[]) => DirEntry[]
  ): Promise<void> {
    await this.storage.update(K_DIR(id), (prev) => {
      const cur: DirEntry[] = prev?.value
        ? (prev.value as unknown as DirEntry[])
        : [];
      return updater(cur) as unknown as JSONValue;
    });
    // CAS 后无法知道结果，清除缓存
    this.dirCache.delete(id);
  }

  // ---- 分块读写工具 -------------------------------------------------------

  /** 从 KV 读取所有分块并拼回完整字符串 */
  async readChunks(id: number, count: number): Promise<string> {
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
  async clearChunks(id: number, count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await this.storage.remove(K_CHUNK(id, i));
    }
  }

  /**
   * 将数据写入分块存储，返回分块数。
   * 调用前需确保旧分块已清除。
   */
  async writeChunked(id: number, data: string): Promise<number> {
    const count = Math.ceil(data.length / CHUNK_SIZE);
    for (let i = 0; i < count; i++) {
      const chunk = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await this.storage.set(K_CHUNK(id, i), chunk as unknown as JSONValue);
    }
    return count;
  }
}
