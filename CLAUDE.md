# Fabric — ArenaPro/Box3 上的虚拟文件系统

## 项目概述

FabricFS 是一个基于游戏引擎 **ArenaPro（Box3）** 的 `GameDataStorage` KV 存储构建的仿 Linux 文件系统。提供文件系统 + debug shell + TTY 远程终端。

## 技术栈

- **运行时**: ArenaPro/Box3 游戏引擎（V8）
- **语言**: TypeScript (strict mode, ESNext)
- **构建**: ArenaPro CLI / DAO3 编辑器（`dao3.config.json`）+ Webpack + ts-loader
- **格式化**: Prettier（tabWidth: 2, singleQuote, trailingComma: es5）
- **Lint**: ESLint + typescript-eslint（strict 模式）

## 架构

```
server/                         客户端（引擎服务端）
  src/App.ts                    — 入口，组装所有模块
  src/fs/
    FileSystem.ts               — 文件系统核心（INode + 分块 KV 存储）
    DebugShell.ts               — shell 逻辑层（命令解析 + 执行）
    Cli.ts                      — 终端渲染（console 输出层）
    RateLimiter.ts              — GameDataStorage 限流包装（token bucket）
    TtyBridge.ts                — RemoteChannel 桥接（服务端 ←→ 客户端）
    StressTest.ts               — 压力测试

client/                         客户端（引擎客户端，浏览器 UI）
  src/clientApp.ts              — 入口
  src/tty/TtyUI.ts              — TTY 终端 UI（ClientUI 实现）

types/                          引擎类型声明
  GameAPI.d.ts                  — 服务端 API（GameDataStorage 等）
  ClientAPI.d.ts                — 客户端 API（UiScreen, RemoteChannel 等）
  GameEntity.d.ts, GamePlayer.d.ts
```

## 构建 & 部署

```sh
# 通过 DAO3 / ArenaPro 编辑器构建上传（dao3.config.json 配置入口）
# 服务端入口: server/src/App.ts
# 客户端入口: client/src/clientApp.ts
# 输出: bundle.js（云端热更）
```

无本地 build 脚本 — 使用 ArenaPro CLI 或 DAO3 编辑器的编译上传功能。

## 关键引擎 API

### GameDataStorage（服务端 KV 存储）

```typescript
class GameDataStorage<T> {
  readonly key: string;
  get(key: string): Promise<ReturnValue<T>>;
  set(key: string, value: T): Promise<void>;
  update(key: string, handler: (prev: ReturnValue<T>) => T): Promise<void>;
  remove(key: string): Promise<ReturnValue<T>>;
  list(options: ListPageOptions): Promise<QueryList<T>>;
  increment(key: string, value?: number): Promise<number>;
  destroy(): Promise<void>;
}
```

### RemoteChannel（前后端通信）

```typescript
// 服务端
remoteChannel.onServerEvent((event: {args: unknown, entity: unknown}) => void);
remoteChannel.sendClientEvent(entity, data);

// 客户端
remoteChannel.sendServerEvent(data);
remoteChannel.onClientEvent((args: unknown) => void);
```

### TTY 协议

```
Client → Server: { type: "tty-cmd", cmd: "ls /" }
Server → Client (n): { type: "tty-stream", data: "line" }   — 流式行
Server → Client:     { type: "tty-result", result: ShellResult }  — 最终结果
```

### ClientUI（客户端 UI）

```typescript
ui          — 引擎默认根节点（保证在渲染树中）
UiScreen    — 屏幕容器（不一定在渲染树中）
UiBox, UiText, UiInput, UiScrollBox  — UI 组件
```

**关键避坑**: `anchor`/`position`/`size` 声明为 `readonly`，须通过可变属性修改：

```typescript
// ❌ 错误
box.position = Vec2.create(...);  // readonly 不能赋值

// ✅ 正确
box.position.offset.x = 100;
box.position.offset.y = 50;
box.position.scale.x = 0;
box.position.scale.y = 0;
```

### Coord2 坐标计算

```
final_position = parent_size * scale + offset
```

- `size.scale(1,1)` = 撑满父容器
- `size.scale(1,0) + size.offset(0, 32)` = 宽占满，高 32px
- `position.scale(0,0) + position.offset(x, y)` = 绝对像素定位

## 代码约定

### 格式

- 2 空格缩进
- 分号必须
- 单引号优先
- 尾逗号（es5 style）
- Prettier 格式化

### TypeScript

- `strict: true`
- 禁止 `any`（`@typescript-eslint/no-explicit-any`），用 `unknown` 替代
- 类型导入用 `import { type X }` / `import type { X }`
- 声明文件用 `.d.ts`（引擎类型在 `types/*.d.ts`）

### 命名

- 文件: PascalCase（组件/类）或 camelCase（工具函数）
- 路径别名: `@src/*`, `@server/*`, `@client/*`, `@shares/*`, `@root/*`

### 文件系统存储格式

```
V            →  { rootInode, nextInode }              超块
I:{id}       →  INode（type, mode, size, data?, ...） inode
D:{id}       →  [{ name, inode }, ...]                目录条目
C:{id}:{n}   →  第 n 个数据分块                       大文件分块
```

## 限流

`RateLimiter.ts` 用 token bucket 包装 `GameDataStorage`：

- 读操作（get, list）: 20 ops/s
- 写操作（set, update, remove, increment, destroy）: 10 ops/s
- 通过 Proxy（已替换为显式包装器）实现，0 `any`

## 流式输出

`DebugShell.execStream()` 支持流式命令（`tree`, `ls`），通过 `emit(line)` 回调逐行输出。`TtyBridge` 攒批发送（每 5 行或 50ms flush），每次 flush 后 `setTimeout(0)` yield 给引擎刷新事件队列。

## CLAUDE.md

本文由 Claude 根据项目结构和代码约定自动生成。保持更新。
