/**
 * DebugShell — FabricFS 调试 shell（纯逻辑层）
 *
 * 职责：解析命令字符串 → 逐行输出（cout）→ 返回成功/失败状态
 * 所有输出通过统一 cout 回调逐行同步到调用方（TTY/CLI）。
 *
 * 用法：
 *   const sh = createShell(fs);
 *   const r = await sh.exec('ls /home', console.log);
 *   if (!r.ok) console.error(r.error);
 */

import { type FabricFS } from '../fs/FileSystem';

// ---- 类型 ------------------------------------------------------------------

/** 流式输出回调 — 每个命令调用它逐行输出结果 */
export type Cout = (line: string) => Promise<void>;

export type ShellResult = { ok: true } | { ok: false; error: string };

/** 最大嵌套脚本深度，防止无限递归 */
const MAX_SCRIPT_DEPTH = 10;

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

/**
 * 按分号切分命令序列，同时识别引号内的分号不做切分。
 * "echo a; echo b" → ["echo a", " echo b"]
 * 'echo "hello; world"' → ['echo "hello; world"']
 */
function splitSemicolon(s: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
      current += c;
    } else if (c === '"' || c === "'") {
      inQuote = c;
      current += c;
    } else if (c === ';') {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts;
}

// ---- 流式 tree（逐行 emit）---------------------------------------------------

async function streamTree(
  fs: FabricFS,
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

/** 处理字符串中的转义序列：\n → 换行，\t → 制表符，\\ → 反斜杠 */
function processEscapes(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

// ---- Shell -----------------------------------------------------------------

type ShellHandler = (cout: Cout, ...args: string[]) => Promise<void>;

export function createShell(fs: FabricFS) {
  let cwd = '/';

  const handlers: Record<string, ShellHandler> = {
    async ls(cout, path) {
      const target = resolvePath(cwd, path || '.');
      const entries = await fs.readdir(target);
      for (const name of entries) {
        const st = await fs.stat(
          target === '/' ? `/${name}` : `${target}/${name}`
        );
        await cout(st?.type === 'dir' ? `${name}/` : name);
      }
    },

    async cat(cout, path) {
      const target = resolvePath(cwd, path);
      const content = await fs.readFile(target);
      if (content === null) throw new Error(`ENOENT: ${target}`);
      const lines = content.split('\n');
      for (const line of lines) {
        await cout(line);
      }
    },

    async chmod(cout, ...args) {
      if (args.length < 2) throw new Error('Usage: chmod <mode> <path>');
      const modeStr = args[0];
      const pathArg = args[1];
      const target = resolvePath(cwd, pathArg);

      let mode: number;
      if (/^\d{3}$/.test(modeStr)) {
        mode = parseInt(modeStr, 8);
      } else if (modeStr === '+x') {
        const st = await fs.stat(target);
        if (st === null) throw new Error(`ENOENT: ${target}`);
        mode = st.mode | 0o111;
      } else if (modeStr === '-x') {
        const st = await fs.stat(target);
        if (st === null) throw new Error(`ENOENT: ${target}`);
        mode = st.mode & ~0o111;
      } else {
        throw new Error(
          `chmod: invalid mode '${modeStr}' (use e.g. 755, +x, -x)`
        );
      }

      await fs.chmod(target, mode);
      const modeDisplay = mode.toString(8).padStart(3, '0');
      await cout(`chmod ${modeDisplay} ${target}`);
    },

    async echo(cout, ...args) {
      const redirIdx = args.indexOf('>');
      if (redirIdx !== -1) {
        const text = processEscapes(args.slice(0, redirIdx).join(' '));
        const rawPath = args[redirIdx + 1];
        if (!rawPath) throw new Error('Usage: echo <text> > <path>');
        const target = resolvePath(cwd, rawPath);
        await fs.writeFile(target, `${text}\n`);
        await cout(`→ written ${target}`);
        return;
      }
      await cout(processEscapes(args.join(' ')));
    },

    async mkdir(cout, path) {
      const target = resolvePath(cwd, path);
      await fs.mkdir(target);
      await cout(target);
    },

    async rm(cout, ...args) {
      let recursive = false;
      let force = false;
      const paths: string[] = [];
      for (const arg of args) {
        if (arg.startsWith('-')) {
          if (arg.includes('r')) recursive = true;
          if (arg.includes('f')) force = true;
        } else {
          paths.push(arg);
        }
      }
      if (!paths.length) throw new Error('Usage: rm [-rf] <path>');
      for (const p of paths) {
        const target = resolvePath(cwd, p);
        try {
          if (recursive || force) {
            await fs.rimraf(target);
          } else {
            await fs.unlink(target);
          }
          await cout(target);
        } catch (err) {
          if (!force) throw err;
        }
      }
    },

    async rmdir(cout, path) {
      const target = resolvePath(cwd, path);
      await fs.rmdir(target);
      await cout(target);
    },

    async mv(cout, oldPath, newPath) {
      const oldTarget = resolvePath(cwd, oldPath);
      const newTarget = resolvePath(cwd, newPath);
      await fs.rename(oldTarget, newTarget);
      await cout(`${oldTarget} → ${newTarget}`);
    },

    async stat(cout, path) {
      const target = resolvePath(cwd, path);
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
      const target = resolvePath(cwd, path || '.');
      await streamTree(fs, target, '', cout);
    },

    async cd(cout, path) {
      const target = resolvePath(cwd, path);
      const st = await fs.stat(target);
      if (st === null) throw new Error(`ENOENT: ${target}`);
      if (st.type !== 'dir')
        throw new Error(`ENOTDIR: ${target} is not a directory`);
      const prev = cwd;
      cwd = target;
      await cout(`${prev} → ${cwd}`);
    },

    async pwd(cout) {
      await cout(cwd);
    },

    async init(cout) {
      await fs.init();
      cwd = '/';
      await cout('init ok');
    },

    async help(cout) {
      const names = Object.keys(handlers).sort();
      for (const name of names) {
        await cout(name);
      }
    },
  };

  // ── exec：公开入口，解析并执行一条命令 ─────────────────────────────────

  async function exec(
    input: string,
    cout: Cout,
    depth = 0
  ): Promise<ShellResult> {
    const trimmed = input.trim();
    if (!trimmed) return { ok: true };

    // 分号分隔的多命令序列
    const cmds = splitSemicolon(trimmed);
    if (cmds.length > 1) {
      let result: ShellResult = { ok: true };
      for (const cmd of cmds) {
        const t = cmd.trim();
        if (!t) continue;
        result = await exec(t, cout, depth);
        if (!result.ok) return result;
      }
      return result;
    }

    const tokens = tokenize(trimmed);
    const cmdName = tokens[0]?.toLowerCase();
    const cmdArgs = tokens.slice(1);
    const handler = handlers[cmdName];

    if (!handler) {
      // eslint-disable-next-line no-use-before-define
      const scriptResult = await tryExecScript(cmdName, cmdArgs, cout, depth);
      if (scriptResult !== null) return scriptResult;

      await cout(`unknown command: ${cmdName}`);
      return { ok: false, error: `unknown command: ${cmdName}` };
    }

    try {
      await handler(cout, ...cmdArgs);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  // ── 脚本块执行（支持 if / else / end）------------------------------------

  /**
   * 在 lines 中找到与 if 行匹配的 else 和 fi（支持嵌套）。
   */
  function findBlockEnd(
    lines: string[],
    ifIdx: number
  ): { endIdx: number; elseIdx: number | null } {
    let elseIdx: number | null = null;
    let depth = 0;
    for (let i = ifIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('if ')) depth++;
      else if (line === 'fi') {
        if (depth === 0) return { endIdx: i, elseIdx };
        depth--;
      } else if (line === 'else' && depth === 0 && elseIdx === null) {
        elseIdx = i;
      }
    }
    return { endIdx: lines.length, elseIdx };
  }

  /**
   * 执行 lines[startIdx..endIdx) 范围内的脚本行，支持 if/then/else/fi 控制流。
   */
  async function execScriptLines(
    lines: string[],
    startIdx: number,
    endIdx: number,
    cout: Cout,
    depth: number
  ): Promise<ShellResult & { failedLine?: number }> {
    let i = startIdx;
    while (i < endIdx) {
      const line = lines[i].trim();
      i++;
      if (line === '' || line.startsWith('#')) continue;
      if (line === 'else' || line === 'fi') continue;

      if (line.startsWith('if ')) {
        // 提取条件：支持 "if condition; then" 和下一行 "then" 两种写法
        let condition = line.slice(3).trim();
        if (condition.endsWith('; then')) {
          condition = condition.slice(0, -6).trim();
        } else if (condition.endsWith(';then')) {
          condition = condition.slice(0, -5).trim();
        } else if (i < endIdx) {
          const nextLine = lines[i].trim();
          if (nextLine === 'then') i++;
        }
        if (!condition) {
          await cout('syntax error: if without condition');
          return { ok: false, error: 'if without condition' };
        }

        const block = findBlockEnd(lines, i - 1);
        const condResult = await exec(condition, cout, depth + 1);

        if (condResult.ok) {
          const r = await execScriptLines(
            lines,
            i,
            block.elseIdx ?? block.endIdx,
            cout,
            depth
          );
          if (!r.ok) return r;
        } else if (block.elseIdx !== null) {
          const r = await execScriptLines(
            lines,
            block.elseIdx + 1,
            block.endIdx,
            cout,
            depth
          );
          if (!r.ok) return r;
        }
        i = block.endIdx + 1;
        continue;
      }

      const r = await exec(line, cout, depth + 1);
      if (!r.ok) {
        await cout(`script error at line ${i}: ${r.error}`);
        return { ok: false, error: r.error, failedLine: i };
      }
    }
    return { ok: true };
  }

  /**
   * 尝试将命令作为脚本文件执行（路径包含 / 或以 . 开头）。
   * 返回 null 表示不是路径型命令，让调用方报 unknown command。
   */
  async function tryExecScript(
    cmdName: string,
    _args: string[],
    cout: Cout,
    depth: number
  ): Promise<ShellResult | null> {
    if (!cmdName.includes('/') && !cmdName.startsWith('.')) return null;

    const resolved = resolvePath(cwd, cmdName);
    const st = await fs.stat(resolved);
    if (st === null) {
      await cout(`ENOENT: ${resolved}: file not found`);
      return { ok: false, error: `ENOENT: ${resolved}` };
    }
    if (st.type !== 'file') {
      await cout(`EISDIR: ${resolved}: is a directory`);
      return { ok: false, error: `EISDIR: ${resolved}` };
    }
    if ((st.mode & 0o111) === 0) {
      await cout(`EACCES: ${resolved}: file is not executable`);
      return { ok: false, error: `EACCES: ${resolved}` };
    }
    if (depth >= MAX_SCRIPT_DEPTH) {
      const msg = `error: max recursion depth (${MAX_SCRIPT_DEPTH}) exceeded`;
      await cout(msg);
      return { ok: false, error: msg };
    }

    const content = await fs.readFile(resolved);
    if (content === null) {
      await cout(`ENOENT: ${resolved}: file not found`);
      return { ok: false, error: `ENOENT: ${resolved}` };
    }

    const lines = content.split('\n');
    const result = await execScriptLines(lines, 0, lines.length, cout, depth);
    if (!result.ok) {
      return {
        ok: false,
        error: `script ${resolved} line ${result.failedLine}: ${result.error}`,
      };
    }
    return { ok: true };
  }

  return { exec };
}
