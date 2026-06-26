# FabricFS API

> FabricFS — 基于 ArenaPro/Box3 `GameDataStorage` KV 存储构建的仿 Linux 文件系统。

## 架构

```
Shell (DebugShell)
  │  IFileSystem 接口
  ▼
FabricVFS                 路径解析 + 虚拟设备 (/dev/null)
  │
  ▼
FabricFS                  INode / 目录条目 / 分块存储
  │
  ▼
GameDataStorage KV        引擎存储层
```

---

## IFileSystem 接口

Shell 和 CLI 只认此接口。`FabricVFS` 和 `FabricFS`（理论上）都可以实现它，但目前 `FabricVFS` 是唯一的实现。

```typescript
interface IFileSystem {
  init(): Promise<void>;
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
```

### FileStat

```typescript
interface FileStat {
  type: 'file' | 'dir';
  mode: number; // 权限位 (0o755, 0o644…)
  size: number;
  uid: number;
  gid: number;
  atime: number; // 毫秒时间戳
  mtime: number;
  ctime: number;
  nlinks: number;
}
```

---

## FabricFS — 底层存储

文件位置：`server/src/fs/file-system.ts`

直接操作 KV 存储，管理 INode、目录条目、大文件分块。所有方法都有缓存（`inodeCache` + `dirCache`），写操作同步更新或失效缓存。

### 元信息

```typescript
init(): Promise<void>
// 初始化文件系统。首次调用创建根目录，后续检测到元信息已存在则直接返回。

getMeta(): Promise<FSMeta>
// 读取元信息：{ rootInode, nextInode, freeInodes? }
```

### INode 管理

```typescript
allocInode(): Promise<number>
// 原子分配新 inode ID。优先从 freeInodes 池复用，否则自增 nextInode。

freeInode(id: number): Promise<void>
// 释放 inode：删除 KV 条目 + 回收 ID 到空闲池。

getINode(id: number): Promise<INode>
// 读 inode（带缓存）。

setINode(id: number, inode: INode): Promise<void>
// 写 inode（更新缓存）。
```

### INode 结构

```typescript
interface INode {
  type: 'file' | 'dir';
  parent: number; // 父目录 inode ID。根目录为 0。
  mode: number;
  uid: number;
  gid: number;
  size: number;
  atime: number;
  mtime: number;
  ctime: number;
  nlinks: number;
  data?: string; // inline 模式：文件内容直接存这里（< 64 KB）
  chunkCount?: number; // 分块模式：≥ 64 KB 时拆成 C:{id}:{n} 多块存储
}
```

### 目录条目

```typescript
getDirEntries(id: number): Promise<DirEntry[]>
// 读目录条目列表（带缓存）。

setDirEntries(id: number, entries: DirEntry[]): Promise<void>
// 写入目录条目（更新缓存）。

updateDirEntries(
  id: number,
  updater: (entries: DirEntry[]) => DirEntry[]
): Promise<void>
// CAS 更新目录条目（清缓存，因为无法预知回调结果）。

removeDirEntries(id: number): Promise<void>
// 删除目录条目 KV 键。
```

```typescript
interface DirEntry {
  name: string;
  inode: number;
}
```

### 大文件分块（≥ 64 KB）

```typescript
readChunks(id: number, count: number): Promise<string>
// 从 KV 读取所有分块并拼接。

clearChunks(id: number, count: number): Promise<void>
// 删除 inode 的所有分块。

writeChunked(id: number, data: string): Promise<number>
// 将数据按 64 KB 分块写入 KV，返回块数。
```

### KV Key 约定

| Key          | 内容             |
| ------------ | ---------------- |
| `V`          | `FSMeta`（超块） |
| `I:{id}`     | `INode`          |
| `D:{id}`     | `DirEntry[]`     |
| `C:{id}:{n}` | 第 n 个数据分块  |

---

## FabricVFS — 虚拟文件系统层

文件位置：`server/src/fs/fabric-vfs.ts`

实现 `IFileSystem`，在 `FabricFS` 之上提供：

- 路径解析（`resolve` / `resolveParent` / `splitPath`）
- 路径级操作（`stat` / `readFile` / `writeFile` / …）
- 虚拟设备注册（`registerDevice`）

### 路径解析

```typescript
// 私有方法：
splitPath(path: string): string[]
// "/home/user/file" → ["home", "user", "file"]

resolve(path: string): Promise<number | null>
// 路径 → inode ID。不存在返回 null。

resolveParent(path: string): Promise<{ parentId: number; name: string }>
// 路径 → { 父目录 inode, 叶子节点名 }。父不存在抛 ENOENT。
```

### 虚拟设备注册

```typescript
registerDevice(path: string, handler: VirtualDevice): void
// 注册虚拟设备/文件。path 必须以绝对路径开头，例如 '/dev/null'。
// 自动创建父目录设备（/dev/foo → /dev 自动建）。
```

### VirtualDevice 接口

```typescript
interface VirtualDevice {
  /** 返回 stat 信息。省略时对该路径返回 null。 */
  stat?: () => FileStat | Promise<FileStat>;

  /** 读文件。省略时对该路径返回 null。 */
  readFile?: () => string | null | Promise<string | null>;

  /** 写文件。省略时对该路径抛 EROFS。 */
  writeFile?: (data: string) => void | Promise<void>;

  /** 列出目录内容。省略时对该路径抛 ENOTDIR。 */
  readdir?: () => string[] | Promise<string[]>;
}
```

### 内置设备

`FabricVFS.init()` 自动注册：

| 设备        | 行为                                      |
| ----------- | ----------------------------------------- |
| `/dev`      | 虚拟目录，`ls /dev` 列出已注册的 `/dev/*` |
| `/dev/null` | 读返回空，写静默丢弃，stat 显示 mode 666  |

### 注册自定义设备示例

```typescript
const vfs = new FabricVFS(fs);
await vfs.init();

vfs.registerDevice('/dev/zero', {
  stat: () => ({
    type: 'file',
    mode: 0o444,
    size: 0,
    uid: 0,
    gid: 0,
    atime: 0,
    mtime: 0,
    ctime: 0,
    nlinks: 1,
  }),
  readFile: () => '\0'.repeat(4096),
});

vfs.registerDevice('/dev/random', {
  stat: () => ({
    type: 'file',
    mode: 0o444,
    size: 0,
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
    for (let i = 0; i < 32; i++) r += chars[Math.floor(Math.random() * 16)];
    return r;
  },
});
```

---

## 使用流程

```typescript
import { FabricFS } from '@src/fs/file-system';
import { FabricVFS } from '@src/fs/fabric-vfs';

const db = rateLimit(storage.getDataStorage('fabric_fs'), {
  readsPerSec: 20,
  writesPerSec: 10,
});

const fs = new FabricVFS(new FabricFS(db));
await fs.init();

// 现在可以传入 Shell/CLI
const { shell } = createCLI(fs);
```

---

## Shell

文件位置：`server/src/shell/Shell.ts`

```typescript
function createShell(fs: IFileSystem): {
  exec(input: string, cout: Cout, depth?: number): Promise<ShellResult>;
  history: readonly string[];
  cwd(): string;
};
```

### ShellResult

```typescript
type ShellResult = { ok: true } | { ok: false; error: string };
```

### Cout

```typescript
type Cout = (line: string) => Promise<void>;
```

### exec() 处理管线

```
input → !! 展开 → 历史记录 → 命令替换 $(...)
     → 控制流 (if/for/while inline)
     → ; 分割 → &&/|| 逻辑链 → | 管道
     → 变量展开 ($var) → tokenize
     → 重定向 (> / >>) → handler 分发
     → 若未命中 handler → tryExecScript()
```

---

## 类型引用速查

| 符号            | 文件             | 导出 |
| --------------- | ---------------- | ---- |
| `IFileSystem`   | `file-system.ts` | 是   |
| `FileStat`      | `file-system.ts` | 是   |
| `FSMeta`        | `file-system.ts` | 是   |
| `INode`         | `file-system.ts` | 是   |
| `DirEntry`      | `file-system.ts` | 是   |
| `CHUNK_SIZE`    | `file-system.ts` | 是   |
| `FabricFS`      | `file-system.ts` | 是   |
| `FabricVFS`     | `fabric-vfs.ts`  | 是   |
| `VirtualDevice` | `fabric-vfs.ts`  | 是   |
| `Cout`          | `Shell.ts`       | 是   |
| `ShellResult`   | `Shell.ts`       | 是   |
| `createShell`   | `Shell.ts`       | 是   |
