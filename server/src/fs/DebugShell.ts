/**
 * DebugShell — FabricFS 调试 shell（纯逻辑层）
 *
 * 职责：解析命令字符串 → 执行 → 返回结构化结果
 * 不碰 console / globalThis，适合测试和程序化调用。
 *
 * 用法：
 *   const sh = createShell(fs);
 *   const r = await sh.exec('ls /home');
 *   if (r.ok) console.log(r.data);
 */

import { type FabricFS } from './FileSystem';
import { runStressTest } from './StressTest';

// ---- 类型 ------------------------------------------------------------------

export interface ShellOk {
  ok: true;
  data: unknown;
}

export interface ShellError {
  ok: false;
  error: string;
}

export type ShellResult = ShellOk | ShellError;

// ---- 路径工具 --------------------------------------------------------------

/** 将任意路径（相对/绝对）解析为绝对路径 */
function resolvePath(cwd: string, input: string): string {
  const target = input.startsWith('/') ? input : `${cwd}/${input}`;
  const parts = target.split('/').filter(Boolean);
  const result: string[] = [];
  for (const p of parts) {
    if (p === '.') continue;
    if (p === '..') {
      result.pop();
    } else {
      result.push(p);
    }
  }
  return `/${result.join('/')}`;
}

// ---- 简易 tokenizer --------------------------------------------------------

function tokenize(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === ' ' || s[i] === '\t') {
      i++;
      continue;
    }
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i];
      i++;
      let buf = '';
      while (i < s.length && s[i] !== quote) buf += s[i++];
      i++;
      tokens.push(buf);
      continue;
    }
    let buf = '';
    while (i < s.length && s[i] !== ' ' && s[i] !== '\t') buf += s[i++];
    tokens.push(buf);
  }
  return tokens;
}

// ---- tree 构建（纯数据，不打印） -------------------------------------------

interface TreeNode {
  name: string;
  type: 'file' | 'dir';
  children?: TreeNode[];
}

async function buildTreeData(
  fs: FabricFS,
  dirPath: string
): Promise<TreeNode[]> {
  const entries = await fs.readdir(dirPath);
  const nodes: TreeNode[] = [];
  for (const name of entries) {
    const childPath = dirPath === '/' ? `/${name}` : `${dirPath}/${name}`;
    const st = await fs.stat(childPath);
    if (st?.type === 'dir') {
      nodes.push({
        name: `${name}/`,
        type: 'dir',
        children: await buildTreeData(fs, childPath),
      });
    } else {
      nodes.push({ name, type: 'file' });
    }
  }
  return nodes;
}

// ---- Shell -----------------------------------------------------------------

type ShellHandler = (...args: string[]) => Promise<ShellResult>;

export function createShell(fs: FabricFS) {
  let cwd = '/';

  // 安全执行命令，确保异常也被捕获为 ShellError
  async function safeRun<T>(fn: () => Promise<T>): Promise<ShellResult> {
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const handlers: Record<string, ShellHandler> = {
    async ls(path) {
      return safeRun(async () => {
        const target = resolvePath(cwd, path || '.');
        const entries = await fs.readdir(target);
        const detailed = await Promise.all(
          entries.map(async (name) => {
            const st = await fs.stat(
              target === '/' ? `/${name}` : `${target}/${name}`
            );
            return { name, isDir: st?.type === 'dir' };
          })
        );
        return detailed;
      });
    },

    async cat(path) {
      return safeRun(async () => {
        const target = resolvePath(cwd, path);
        const content = await fs.readFile(target);
        if (content === null) throw new Error(`ENOENT: ${target}`);
        return content;
      });
    },

    async echo(...args) {
      const redirIdx = args.indexOf('>');
      if (redirIdx !== -1) {
        return safeRun(async () => {
          const text = args
            .slice(0, redirIdx)
            .join(' ')
            .replace(/^["']|["']$/g, '');
          const rawPath = args[redirIdx + 1];
          if (!rawPath) throw new Error('Usage: echo <text> > <path>');
          const target = resolvePath(cwd, rawPath);
          await fs.writeFile(target, `${text}\n`);
          return { path: target, text };
        });
      }
      return { ok: true, data: args.join(' ') };
    },

    async mkdir(path) {
      return safeRun(async () => {
        const target = resolvePath(cwd, path);
        await fs.mkdir(target);
        return target;
      });
    },

    async rm(path) {
      return safeRun(async () => {
        const target = resolvePath(cwd, path);
        await fs.unlink(target);
        return target;
      });
    },

    async rmdir(path) {
      return safeRun(async () => {
        const target = resolvePath(cwd, path);
        await fs.rmdir(target);
        return target;
      });
    },

    async mv(oldPath, newPath) {
      return safeRun(async () => {
        const oldTarget = resolvePath(cwd, oldPath);
        const newTarget = resolvePath(cwd, newPath);
        await fs.rename(oldTarget, newTarget);
        return { from: oldTarget, to: newTarget };
      });
    },

    async stat(path) {
      return safeRun(async () => {
        const target = resolvePath(cwd, path);
        const st = await fs.stat(target);
        if (st === null) throw new Error(`ENOENT: ${target}`);
        return st;
      });
    },

    async tree(path) {
      return safeRun(async () => {
        const target = resolvePath(cwd, path || '.');
        return buildTreeData(fs, target);
      });
    },

    async cd(path) {
      return safeRun(async () => {
        const target = resolvePath(cwd, path);
        const st = await fs.stat(target);
        if (st === null) throw new Error(`ENOENT: ${target}`);
        if (st.type !== 'dir')
          throw new Error(`ENOTDIR: ${target} is not a directory`);
        const prev = cwd;
        cwd = target;
        return { from: prev, to: cwd };
      });
    },

    async pwd() {
      return { ok: true, data: cwd };
    },

    async init() {
      return safeRun(async () => {
        await fs.init();
        cwd = '/';
      });
    },

    async help() {
      return {
        ok: true,
        data: Object.keys(handlers).sort(),
      };
    },

    async stress() {
      return safeRun(async () => {
        await runStressTest(fs);
      });
    },
  };

  // ── exec：公开入口，解析并执行一条命令 ─────────────────────────────────

  async function exec(input: string): Promise<ShellResult> {
    const trimmed = input.trim();
    if (!trimmed) return { ok: true, data: undefined };

    const tokens = tokenize(trimmed);
    const cmdName = tokens[0]?.toLowerCase();
    const cmdArgs = tokens.slice(1);
    const handler = handlers[cmdName];

    if (!handler) {
      return { ok: false, error: `unknown command: ${cmdName}` };
    }

    return handler(...cmdArgs);
  }

  return { exec };
}
