/**
 * commands — 内置命令统一管理
 *
 * 将所有命令 handler 集中在此文件，通过 createHandlers(env) 注入依赖。
 * Shell.ts 不再直接定义 handler，改为调用 createHandlers。
 */

import { type IFileSystem } from '../fs/FileSystem';
import { type FabricVFS } from '../fs/FabricVFS';
import { Path } from '../fs/Path';
import { edHandler } from './ed';

// ---- 类型 ------------------------------------------------------------------

export type Cout = (line: string) => Promise<void>;
export type ShellHandler = (cout: Cout, ...args: string[]) => Promise<void>;

/**
 * handler 运行所需的环境依赖。
 * 可变状态通过 ref 对象传递（cwdRef、pipeInputRef），
 * 保证 handler 读到的是最新值。
 */
export interface CmdEnv {
  fs: IFileSystem;
  vfs?: FabricVFS;
  cwdRef: { value: string };
  vars: Map<string, string>;
  pipeInputRef: { value: string | null };
  history: string[];
  getHandler: (name: string) => ShellHandler | undefined;
  /** 根据 storageId 创建 RootFS 并挂载到指定路径 */
  mountStorage?: (path: string, storageId: string) => Promise<void>;
  /** 游戏引擎 tick（每帧执行） */
  worldOnTick?: (cb: () => void) => void;
  /** 交互式输入（ed 等命令使用） */
  inputLine?: () => Promise<string> | undefined;
}

// ---- 工厂 ------------------------------------------------------------------

export function createHandlers(env: CmdEnv): Record<string, ShellHandler> {
  const {
    fs,
    vfs,
    cwdRef,
    vars,
    pipeInputRef,
    history,
    getHandler,
    mountStorage,
    worldOnTick,
    inputLine,
  } = env;
  const cwd = () => cwdRef.value;
  const pipeInput = () => pipeInputRef.value;

  function resolve(p: string): string {
    return Path.resolve(cwd(), p || '.');
  }

  return {
    // ---- 文件操作 ----------------------------------------------------------

    async ls(cout, path) {
      const target = resolve(path || '.');
      const st = await fs.stat(target);
      if (st === null) throw new Error(`ENOENT: ${target}`);
      if (st.type === 'file') {
        await cout(target.split('/').pop()!);
        return;
      }
      const entries = await fs.readdir(target);
      for (const name of entries) {
        const childSt = await fs.stat(
          target === '/' ? `/${name}` : `${target}/${name}`
        );
        await cout(childSt?.type === 'dir' ? `${name}/` : name);
      }
    },

    async cat(cout, path) {
      if (!path && pipeInput() !== null) {
        for (const line of pipeInput()!.split('\n')) await cout(line);
        return;
      }
      const target = resolve(path);
      const content = await fs.readFile(target);
      if (content === null) throw new Error(`ENOENT: ${target}`);
      for (const line of content.split('\n')) await cout(line);
    },

    async chmod(cout, ...args) {
      if (args.length < 2) throw new Error('Usage: chmod <mode> <path>');
      const target = resolve(args[1]);
      let mode: number;
      if (/^\d{3}$/.test(args[0])) {
        mode = parseInt(args[0], 8);
      } else if (args[0] === '+x') {
        const st = await fs.stat(target);
        if (st === null) throw new Error(`ENOENT: ${target}`);
        mode = st.mode | 0o111;
      } else if (args[0] === '-x') {
        const st = await fs.stat(target);
        if (st === null) throw new Error(`ENOENT: ${target}`);
        mode = st.mode & ~0o111;
      } else {
        throw new Error(`chmod: invalid mode '${args[0]}'`);
      }
      await fs.chmod(target, mode);
    },

    async echo(cout, ...args) {
      await cout(processEscapes(args.join(' ')));
    },

    async mkdir(_cout, path) {
      await fs.mkdir(resolve(path));
    },

    async rm(_cout, ...args) {
      let recursive = false,
        force = false;
      const paths: string[] = [];
      for (const a of args) {
        if (a.startsWith('-')) {
          if (a.includes('r')) recursive = true;
          if (a.includes('f')) force = true;
        } else {
          paths.push(a);
        }
      }
      if (!paths.length) throw new Error('Usage: rm [-rf] <path>');
      for (const p of paths) {
        const target = resolve(p);
        try {
          if (recursive || force) await fs.rimraf(target);
          else await fs.unlink(target);
        } catch (err) {
          if (!force) throw err;
        }
      }
    },

    async rmdir(_cout, path) {
      await fs.rmdir(resolve(path));
    },

    async mv(_cout, oldPath, newPath) {
      await fs.rename(resolve(oldPath), resolve(newPath));
    },

    async cp(_cout, src, dst) {
      if (!src || !dst) throw new Error('Usage: cp <src> <dst>');
      const content = await fs.readFile(resolve(src));
      if (content === null) throw new Error(`ENOENT: ${resolve(src)}`);
      await fs.writeFile(resolve(dst), content);
    },

    async touch(_cout, path) {
      const target = resolve(path);
      const st = await fs.stat(target);
      if (st === null) {
        await fs.writeFile(target, '');
      }
    },

    // ---- 信息查询 ----------------------------------------------------------

    async stat(cout, path) {
      const target = resolve(path);
      const st = await fs.stat(target);
      if (st === null) throw new Error(`ENOENT: ${target}`);
      const typeStr = st.type === 'dir' ? 'd' : '-';
      const modeStr =
        ((st.mode >> 6) & 7).toString(8) +
        ((st.mode >> 3) & 7).toString(8) +
        (st.mode & 7).toString(8);
      await cout(`${typeStr}${modeStr}  ${st.nlinks}  ${st.uid}:${st.gid}`);
      await cout(`  size: ${st.size}`);
      await cout(`  atime: ${new Date(st.atime).toISOString()}`);
      await cout(`  mtime: ${new Date(st.mtime).toISOString()}`);
      await cout(`  ctime: ${new Date(st.ctime).toISOString()}`);
    },

    async tree(cout, path) {
      const target = resolve(path || '.');
      await streamTree(fs, target, '', cout);
    },

    // ---- 导航 --------------------------------------------------------------

    async cd(_cout, path) {
      if (path === undefined) return;
      const target = resolve(path);
      const st = await fs.stat(target);
      if (st === null) throw new Error(`ENOENT: ${target}`);
      if (st.type !== 'dir')
        throw new Error(`ENOTDIR: ${target} is not a directory`);
      cwdRef.value = target;
    },

    async pwd(cout) {
      await cout(cwd());
    },

    // ---- 系统 --------------------------------------------------------------

    async init(cout) {
      await fs.init();
      cwdRef.value = '/';
      await cout('init ok');
    },

    async clear() {
      /* 客户端处理 */
    },

    async sleep(_cout, seconds) {
      const sec = parseFloat(seconds);
      if (isNaN(sec) || sec < 0) throw new Error('Usage: sleep <seconds>');
      await new Promise((r) => setTimeout(r, sec * 1000));
    },

    // ---- socket ------------------------------------------------------------

    async sock(cout, subcmd, path) {
      if (subcmd === 'cat') {
        if (!path) throw new Error('Usage: sock cat <path>');
        const target = resolve(path);
        const line = await fs.readFile(target);
        if (line !== null && line.length > 0) await cout(line);
        return;
      }
      if (subcmd === 'listen') {
        if (!path) throw new Error('Usage: sock listen <path>');
        const target = resolve(path);
        if (!worldOnTick) throw new Error('sock: world.onTick not available');
        worldOnTick(async () => {
          const line = await fs.readFile(target);
          if (line !== null && line.length > 0) await cout(line);
        });
        await cout(`listening on ${target}`);
        return;
      }
      if (subcmd === 'create') {
        if (!path) throw new Error('Usage: sock create <path>');
        const target = resolve(path);
        if (!vfs) throw new Error('sock: VFS not available');
        vfs.registerSocket(target);
        await cout(`socket created at ${target}`);
        return;
      }
      throw new Error(
        `sock: unknown subcommand '${subcmd}' (try: cat, create)`
      );
    },

    // ---- 帮助 --------------------------------------------------------------

    async help(cout) {
      const names = Object.keys(getHandler('help') ? getHandlers() : {}).sort();
      for (const n of names) await cout(n);
    },

    async history(cout) {
      for (let i = 0; i < history.length; i++) {
        await cout(`${i + 1}  ${history[i]}`);
      }
    },

    async fabric(cout, flag) {
      if (flag === '-v' || flag === '--version') {
        await cout('FabricFS v0.2 — ArenaPro virtual filesystem');
        return;
      }
      throw new Error('Usage: fabric -v');
    },

    // ---- 变量 --------------------------------------------------------------

    ['export']: async (cout, ...args) => {
      if (args.length === 0) {
        // export — 列出所有已导出的变量
        for (const [k, v] of vars) {
          await cout(`export ${k}=${v}`);
        }
        return;
      }
      for (const a of args) {
        const eq = a.indexOf('=');
        if (eq !== -1) {
          const name = a.slice(0, eq);
          const val = a.slice(eq + 1);
          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            vars.set(name, val);
          }
        } else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(a)) {
          // export name — 确保存在（已有值不变）
          if (!vars.has(a)) vars.set(a, '');
        }
      }
    },

    async unset(_cout, name) {
      if (!name) throw new Error('Usage: unset <name>');
      vars.delete(name);
    },

    async env(cout) {
      const names = Array.from(vars.keys()).sort();
      for (const k of names) {
        await cout(`${k}=${vars.get(k)}`);
      }
    },

    // ---- 系统管理 ----------------------------------------------------------

    async mount(cout, path, storageId) {
      if (!vfs) throw new Error('mount: not available (no VFS)');
      if (path && storageId) {
        // mount <path> <storageId> — 挂载外部存储
        if (!mountStorage) throw new Error('mount: storage not available');
        const target = Path.resolve(cwd(), path);
        await mountStorage(target, storageId);
        await cout(`mounted ${storageId} at ${target}`);
        return;
      }
      // mount — 列出挂载点
      const list = vfs.getMounts();
      for (const m of list) {
        await cout(`${m.prefix}  ${m.type}`);
      }
    },

    async unmount(cout, prefix) {
      if (!vfs) throw new Error('unmount: not available (no VFS)');
      if (!prefix) throw new Error('Usage: unmount <path>');
      vfs.unmount(prefix);
      await cout(`unmounted ${prefix}`);
    },

    async format(cout, path) {
      if (path && vfs) {
        const target = Path.resolve(cwd(), path);
        const targetFs = vfs.getFs(target);
        if (!targetFs) throw new Error(`format: no filesystem at ${target}`);
        await targetFs.format();
        if (target === cwd()) cwdRef.value = '/';
        await cout(`format ok: ${target}`);
        return;
      }
      await fs.format();
      cwdRef.value = '/';
      await cout('format ok');
    },

    // ---- 控制流条件 ----------------------------------------------------------

    async test(cout, ...args) {
      if (args.length === 0) throw new Error('test: missing operand');
      const op = args[0];
      if (op === '-f' || op === '-d' || op === '-e') {
        const target = Path.resolve(cwd(), args[1]);
        const st = await fs.stat(target);
        if (op === '-e' && st === null) throw new Error('false');
        if (op === '-f' && (st === null || st.type !== 'file'))
          throw new Error('false');
        if (op === '-d' && (st === null || st.type !== 'dir'))
          throw new Error('false');
        return;
      }
      if (op === '-n') {
        if (!args[1]) throw new Error('false');
        return;
      }
      if (op === '-z') {
        if (args[1]) throw new Error('false');
        return;
      }
      if (args.length === 3 && args[1] === '=') {
        if (args[0] !== args[2]) throw new Error('false');
        return;
      }
      if (args.length === 3 && args[1] === '!=') {
        if (args[0] === args[2]) throw new Error('false');
        return;
      }
      if (args.length === 1) {
        if (!args[0]) throw new Error('false');
        return;
      }
      throw new Error(`test: unknown operator '${op}'`);
    },

    '[': async (cout, ...args) => {
      if (args.length < 1 || args[args.length - 1] !== ']')
        throw new Error('[: missing ]');
      const testHandler = getHandler('test');
      if (testHandler) await testHandler(cout, ...args.slice(0, -1));
    },

    true: async () => {},
    false: async () => {
      throw new Error('false');
    },

    // ---- 文本处理 ----------------------------------------------------------

    async grep(cout, ...args) {
      let invert = false,
        ignoreCase = false;
      let pattern: string | undefined, fileArg: string | undefined;
      for (const a of args) {
        if (a === '-v') invert = true;
        else if (a === '-i') ignoreCase = true;
        else if (a.startsWith('-')) throw new Error(`grep: unknown flag ${a}`);
        else if (!pattern) pattern = a;
        else fileArg = a;
      }
      if (!pattern) throw new Error('Usage: grep [-i] [-v] <pattern> [file]');
      let input: string;
      if (fileArg) {
        const target = resolve(fileArg);
        const c = await fs.readFile(target);
        if (c === null) throw new Error(`ENOENT: ${target}`);
        input = c;
      } else if (pipeInput() !== null) {
        input = pipeInput()!;
      } else {
        throw new Error('grep: no input');
      }
      for (const line of input.split('\n')) {
        let match = ignoreCase
          ? line.toLowerCase().includes(pattern.toLowerCase())
          : line.includes(pattern);
        if (invert) match = !match;
        if (match) await cout(line);
      }
    },

    async head(cout, ...args) {
      let count = 10,
        countIsChars = false;
      let path: string | undefined;
      for (const a of args) {
        if (a === '-c') countIsChars = true;
        else if (a === '-n') countIsChars = false;
        else if (!isNaN(Number(a))) count = Number(a);
        else path = a;
      }
      let input: string;
      if (path) {
        const target = resolve(path);
        const c = await fs.readFile(target);
        if (c === null) throw new Error(`ENOENT: ${target}`);
        input = c;
      } else if (pipeInput() !== null) {
        input = pipeInput()!;
      } else {
        throw new Error('head: no input');
      }
      if (countIsChars) {
        await cout(input.slice(0, count));
      } else {
        const lines = input.split('\n');
        for (let i = 0; i < Math.min(count, lines.length); i++)
          await cout(lines[i]);
      }
    },

    ed: edHandler({ fs, cwd, inputLine }),
  };
}

// ---- 转义处理（给 echo 用）--------------------------------------------------

function processEscapes(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

// ---- 流式 tree（给 tree 命令用）---------------------------------------------

async function streamTree(
  fs: IFileSystem,
  dirPath: string,
  prefix: string,
  emit: (line: string) => Promise<void>
): Promise<void> {
  const entries = await fs.readdir(dirPath);
  for (let i = 0; i < entries.length; i++) {
    const isLast = i === entries.length - 1;
    const name = entries[i];
    const childPath = dirPath === '/' ? `/${name}` : `${dirPath}/${name}`;
    const st = await fs.stat(childPath);
    const connector = isLast ? '└─ ' : '├─ ';
    const display = st?.type === 'dir' ? `${name}/` : name;
    await emit(`${prefix}${connector}${display}`);
    if (st?.type === 'dir') {
      await streamTree(fs, childPath, prefix + (isLast ? '   ' : '│  '), emit);
    }
  }
}

// ---- 获取所有 handlers（给 help 用）-----------------------------------------

let _allHandlers: Record<string, ShellHandler> = {};

export function setAllHandlers(h: Record<string, ShellHandler>): void {
  _allHandlers = h;
}

export function getHandlers(): Record<string, ShellHandler> {
  return _allHandlers;
}
