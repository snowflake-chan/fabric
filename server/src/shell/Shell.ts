/**
 * DebugShell — FabricFS shell（纯逻辑层）
 *
 * 解析命令字符串 → 逐行输出（cout）→ 返回成功/失败状态
 * 所有命令 handler 在 commands.ts 中统一管理。
 */

import { type IFileSystem } from '../fs/FileSystem';
import { type FabricVFS } from '../fs/FabricVFS';
import { Path } from '../fs/Path';
import { type Cout, createHandlers, setAllHandlers } from './commands';

export type { Cout };
export type ShellResult = { ok: true } | { ok: false; error: string };

const MAX_SCRIPT_DEPTH = 10;
const MAX_LOOP_ITERATIONS = 10000;

// ---- tokenizer & 语法解析 ------------------------------------------------

function tokenize(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === ' ' || s[i] === '\t') {
      i++;
      continue;
    }
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i];
      i++;
      let b = '';
      while (i < s.length && s[i] !== q) b += s[i++];
      i++;
      tokens.push(b);
      continue;
    }
    let b = '';
    while (i < s.length && s[i] !== ' ' && s[i] !== '\t') b += s[i++];
    tokens.push(b);
  }
  return tokens;
}

function splitSemicolon(s: string): string[] {
  const parts: string[] = [];
  let cur = '',
    q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === ';') {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

function parseLogical(
  s: string
): Array<{ cmd: string; require: 'success' | 'failure' | null }> {
  const result: Array<{ cmd: string; require: 'success' | 'failure' | null }> =
    [];
  let cur = '',
    q: string | null = null,
    next: 'success' | 'failure' | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === '&' && s[i + 1] === '&') {
      result.push({ cmd: cur.trim(), require: next });
      cur = '';
      next = 'success';
      i++;
    } else if (c === '|' && s[i + 1] === '|') {
      result.push({ cmd: cur.trim(), require: next });
      cur = '';
      next = 'failure';
      i++;
    } else cur += c;
  }
  const last = cur.trim();
  if (last) result.push({ cmd: last, require: next });
  return result;
}

function parsePipe(s: string): string[] {
  const parts: string[] = [];
  let cur = '',
    q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === '|' && s[i + 1] !== '|') {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts.filter((p) => p.trim().length > 0);
}

// ---- 命令替换 ------------------------------------------------------------

async function expandSubstitutions(
  s: string,
  cout: Cout,
  depth: number,
  execRef: (input: string, cout: Cout, depth: number) => Promise<ShellResult>
): Promise<string | null> {
  let result = '',
    i = 0;
  while (i < s.length) {
    const start = s.indexOf('$(', i);
    if (start === -1) {
      result += s.slice(i);
      break;
    }
    result += s.slice(i, start);
    let pd = 1,
      j = start + 2;
    while (j < s.length && pd > 0) {
      if (s[j] === '(') pd++;
      else if (s[j] === ')') pd--;
      if (pd > 0) j++;
    }
    if (pd !== 0) {
      result += s.slice(start);
      break;
    }
    const inner = s.slice(start + 2, j);
    const captured: string[] = [];
    const cc: Cout = async (l) => {
      captured.push(l);
    };
    const r = await execRef(inner.trim(), cc, depth + 1);
    if (!r.ok) return null;
    result += captured.join('\n');
    i = j + 1;
  }
  return result !== s ? result : null;
}

// ---- Shell ---------------------------------------------------------------

export function createShell(
  fs: IFileSystem,
  vfs?: FabricVFS,
  mountStorage?: (path: string, storageId: string) => Promise<void>,
  worldOnTick?: (cb: () => void) => void
) {
  const cwdRef = { value: '/' };
  const history: string[] = [];
  const MAX_HISTORY = 100;
  const vars = new Map<string, string>();
  const pipeInputRef = { value: null as string | null };

  const handlers = createHandlers({
    fs,
    vfs,
    cwdRef,
    vars,
    pipeInputRef,
    history,
    getHandler: (n) => handlers[n],
    mountStorage,
    worldOnTick,
    inputLine: () => currentInputLine?.(),
  });
  setAllHandlers(handlers);

  /** 交互输入（由 TtyBridge 在每次 exec 前设置） */
  let currentInputLine: (() => Promise<string>) | undefined;

  // ---- exec ----------------------------------------------------------------

  async function exec(
    input: string,
    cout: Cout,
    depth = 0,
    inputLine?: () => Promise<string>
  ): Promise<ShellResult> {
    currentInputLine = inputLine;
    const trimmed = input.trim();
    if (!trimmed) return { ok: true };

    // !! 展开上一条命令
    const expanded =
      trimmed === '!!' ? (history[history.length - 1] ?? '') : trimmed;
    if (trimmed === '!!') {
      if (!expanded) return { ok: false, error: 'no previous command' };
      await cout(expanded);
    }

    // 记录历史
    if (depth === 0 && expanded) {
      history.push(expanded);
      if (history.length > MAX_HISTORY) history.shift();
    }

    // 控制流
    if (expanded && /^(if|for|while)\s/.test(expanded)) {
      const ifMatch = expanded.match(/^if\s+(.+?);\s*then\s+(.+);\s*fi$/);
      if (ifMatch) {
        const condition = ifMatch[1],
          rest = ifMatch[2];
        const em = rest.match(/^(.*?);\s*else\s+(.+)$/);
        const thenBody = em ? em[1] : rest;
        const elseBody = em ? em[2] : null;
        const cr = await exec(condition, cout, depth);
        if (cr.ok) {
          if (thenBody) return await exec(thenBody, cout, depth);
        } else if (elseBody) return await exec(elseBody, cout, depth);
        return { ok: true };
      }
      const forMatch = expanded.match(
        /^for\s+(\w+)\s+in\s+(.+?);\s*do\s+(.+);\s*done$/
      );
      if (forMatch) {
        const [, varname, wordList, body] = forMatch;
        const words = tokenize(wordList);
        const oldVal = vars.get(varname);
        for (
          let iter = 0;
          iter < MAX_LOOP_ITERATIONS && iter < words.length;
          iter++
        ) {
          vars.set(varname, words[iter]);
          const r = await exec(body, cout, depth);
          if (!r.ok) return r;
        }
        if (oldVal !== undefined) vars.set(varname, oldVal);
        else vars.delete(varname);
        return { ok: true };
      }
      const whileMatch = expanded.match(/^while\s+(.+?);\s*do\s+(.+);\s*done$/);
      if (whileMatch) {
        const [, condition, body] = whileMatch;
        for (let iter = 0; iter < MAX_LOOP_ITERATIONS; iter++) {
          const cr = await exec(condition, cout, depth);
          if (!cr.ok) break;
          const r = await exec(body, cout, depth);
          if (!r.ok) return r;
        }
        return { ok: true };
      }

      return execScriptLines([expanded], 0, 1, cout, depth);
    }

    // 命令替换
    if (expanded.includes('$(')) {
      const subResult = await expandSubstitutions(expanded, cout, depth, exec);
      if (subResult !== null) return exec(subResult, cout, depth);
    }

    // ; 分割
    const cmds = splitSemicolon(trimmed);
    if (cmds.length > 1) {
      let result: ShellResult = { ok: true };
      for (const cmd of cmds) {
        const t = cmd.trim();
        if (!t) continue;
        result = await exec(t, cout, depth + 1);
        if (!result.ok) return result;
      }
      return result;
    }

    // && / ||
    const steps = parseLogical(trimmed);
    if (steps.length > 1) {
      let result: ShellResult = { ok: true };
      for (const step of steps) {
        if (step.require === 'success' && !result.ok) continue;
        if (step.require === 'failure' && result.ok) continue;
        result = await exec(step.cmd, cout, depth + 1);
      }
      return result;
    }

    // | 管道
    const pipeCmds = parsePipe(trimmed);
    if (pipeCmds.length > 1) {
      let prevOutput: string | null = null;
      for (let i = 0; i < pipeCmds.length; i++) {
        const captured: string[] = [];
        const pc: Cout =
          i < pipeCmds.length - 1
            ? async (line) => {
                captured.push(line);
              }
            : cout;
        pipeInputRef.value = prevOutput;
        const r = await exec(pipeCmds[i].trim(), pc, depth + 1);
        if (!r.ok) return r;
        prevOutput = captured.join('\n');
      }
      pipeInputRef.value = null;
      return { ok: true };
    }

    // 变量展开
    let expandedLine = trimmed;
    if (vars.size > 0) {
      for (const [k, v] of vars)
        expandedLine = expandedLine.replaceAll(`$${k}`, v);
    }

    const tokens = tokenize(expandedLine);
    const rawName = tokens[0];
    const cmdName = rawName?.toLowerCase();
    const cmdArgs = tokens.slice(1);

    // 变量赋值：name=value
    const assignMatch = rawName?.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
    if (assignMatch) {
      const [, varName, varValue] = assignMatch;
      if (cmdArgs.length === 0) {
        vars.set(varName, varValue);
        return { ok: true };
      }
      // VAR=val command — 临时设变量，跑完命令后恢复
      const oldVal = vars.get(varName);
      vars.set(varName, varValue);
      const r = await exec(cmdArgs.join(' '), cout, depth);
      if (oldVal !== undefined) vars.set(varName, oldVal);
      else vars.delete(varName);
      return r;
    }

    // < 输入重定向
    const inRedirIdx = cmdArgs.indexOf('<');
    let runArgs = cmdArgs;
    if (inRedirIdx !== -1) {
      const rawPath = cmdArgs[inRedirIdx + 1];
      if (!rawPath || rawPath.startsWith('-'))
        return { ok: false, error: 'syntax error: < without target' };
      const target = `/${rawPath.startsWith('/') ? rawPath.slice(1) : `${cwdRef.value.slice(1)}/${rawPath}`}`;
      const content = await fs.readFile(target);
      if (content === null) return { ok: false, error: `ENOENT: ${target}` };
      pipeInputRef.value = content;
      runArgs = cmdArgs
        .slice(0, inRedirIdx)
        .concat(cmdArgs.slice(inRedirIdx + 2));
    }

    // > / >> 重定向
    const redirIdx = runArgs.indexOf('>>');
    const redirSglIdx = redirIdx !== -1 ? -1 : runArgs.indexOf('>');
    const hasRedirect = redirIdx !== -1 || redirSglIdx !== -1;
    let runCout = cout;
    let redirectTarget: string | null = null;
    const redirectAppend = redirIdx !== -1;
    const captured: string[] = [];

    async function writeRedirect(): Promise<void> {
      if (!redirectTarget) return;
      const content = captured.join('\n') + (captured.length > 0 ? '\n' : '');
      if (redirectAppend) {
        const existing = await fs.readFile(redirectTarget);
        await fs.writeFile(redirectTarget, (existing ?? '') + content);
      } else {
        await fs.writeFile(redirectTarget, content);
      }
    }

    if (hasRedirect) {
      const idx = redirectAppend ? redirIdx : redirSglIdx;
      const rawPath = runArgs[idx + 1];
      if (!rawPath || rawPath.startsWith('-'))
        return { ok: false, error: 'syntax error: redirect without target' };
      redirectTarget = `/${rawPath.startsWith('/') ? rawPath.slice(1) : `${cwdRef.value.slice(1)}/${rawPath}`}`;
      runArgs = runArgs.slice(0, idx).concat(runArgs.slice(idx + 2));
      runCout = async (line) => {
        captured.push(line);
      };
    }

    const handler = handlers[cmdName];

    if (!handler) {
      const scriptResult = await tryExecScript(
        cmdName,
        runArgs,
        runCout,
        depth
      );
      if (scriptResult !== null) {
        await writeRedirect();
        return scriptResult;
      }
      return { ok: false, error: `unknown command: ${cmdName}` };
    }

    try {
      await handler(runCout, ...runArgs);
      await writeRedirect();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  // ---- 脚本块执行 ---------------------------------------------------------

  function findBlockEnd(
    lines: string[],
    openIdx: number
  ): { endIdx: number; elseIdx: number | null } {
    let elseIdx: number | null = null,
      depth = 0;
    for (let i = openIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (
        line.startsWith('if ') ||
        line.startsWith('for ') ||
        line.startsWith('while ')
      )
        depth++;
      else if (line === 'fi' || line === 'done') {
        if (depth === 0) return { endIdx: i, elseIdx };
        depth--;
      } else if (line === 'else' && depth === 0 && elseIdx === null)
        elseIdx = i;
    }
    return { endIdx: lines.length, elseIdx };
  }

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
      if (line === 'else' || line === 'fi' || line === 'done') continue;
      if (line === 'then' || line === 'do') continue;

      if (line.startsWith('if ')) {
        if (/;\s*fi(?:\s|$)/.test(line)) {
          const r = await exec(line, cout, depth + 1);
          if (!r.ok) return r;
          i++;
          continue;
        }
        let condition = line.slice(3).trim();
        if (condition.endsWith('; then'))
          condition = condition.slice(0, -6).trim();
        else if (condition.endsWith(';then'))
          condition = condition.slice(0, -5).trim();
        else if (i < endIdx) {
          const nl = lines[i].trim();
          if (nl === 'then') i++;
        }
        if (!condition)
          return { ok: false, error: 'syntax error: if without condition' };
        const block = findBlockEnd(lines, i - 1);
        const cr = await exec(condition, cout, depth + 1);
        if (cr.ok) {
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

      if (line.startsWith('for ')) {
        if (/;\s*done(?:\s|$)/.test(line)) {
          const r = await exec(line, cout, depth + 1);
          if (!r.ok) return r;
          i++;
          continue;
        }
        const rest = line.slice(4).trim();
        const parts = rest.split(/\s+/);
        const varname = parts[0];
        const inIdx = parts.indexOf('in');
        if (inIdx === -1)
          return { ok: false, error: 'syntax error: for without in' };
        const doIdx = parts.indexOf('do');
        let words: string[];
        if (doIdx !== -1) words = parts.slice(inIdx + 1, doIdx);
        else {
          words = parts.slice(inIdx + 1);
          if (i < endIdx) {
            const nl = lines[i].trim();
            if (nl === 'do') i++;
          }
        }
        const block = findBlockEnd(lines, i - 1);
        const oldVal = vars.get(varname);
        for (
          let iter = 0;
          iter < MAX_LOOP_ITERATIONS && iter < words.length;
          iter++
        ) {
          vars.set(varname, words[iter]);
          const r = await execScriptLines(lines, i, block.endIdx, cout, depth);
          if (!r.ok) return r;
        }
        if (oldVal !== undefined) vars.set(varname, oldVal);
        else vars.delete(varname);
        i = block.endIdx + 1;
        continue;
      }

      if (line.startsWith('while ')) {
        if (/;\s*done(?:\s|$)/.test(line)) {
          const r = await exec(line, cout, depth + 1);
          if (!r.ok) return r;
          i++;
          continue;
        }
        let condition = line.slice(6).trim();
        if (condition.endsWith('; do'))
          condition = condition.slice(0, -4).trim();
        else if (condition.endsWith(';do'))
          condition = condition.slice(0, -3).trim();
        else if (i < endIdx) {
          const nl = lines[i].trim();
          if (nl === 'do') i++;
        }
        if (!condition)
          return { ok: false, error: 'syntax error: while without condition' };
        const block = findBlockEnd(lines, i - 1);
        for (let iter = 0; iter < MAX_LOOP_ITERATIONS; iter++) {
          const cr = await exec(condition, cout, depth + 1);
          if (!cr.ok) break;
          const r = await execScriptLines(lines, i, block.endIdx, cout, depth);
          if (!r.ok) return r;
        }
        i = block.endIdx + 1;
        continue;
      }

      const r = await exec(line, cout, depth + 1);
      if (!r.ok) return { ok: false, error: r.error, failedLine: i };
    }
    return { ok: true };
  }

  // ---- 脚本文件执行 -------------------------------------------------------

  async function tryExecScript(
    cmdName: string,
    _args: string[],
    cout: Cout,
    depth: number
  ): Promise<ShellResult | null> {
    if (!cmdName.includes('/') && !cmdName.startsWith('.')) return null;
    const resolved = cmdName.startsWith('/')
      ? cmdName
      : Path.resolve(cwdRef.value, cmdName);
    const st = await fs.stat(resolved);
    if (st === null) return { ok: false, error: `ENOENT: ${resolved}` };
    if (st.type !== 'file') return { ok: false, error: `EISDIR: ${resolved}` };
    if ((st.mode & 0o111) === 0)
      return { ok: false, error: `EACCES: ${resolved}` };
    if (depth >= MAX_SCRIPT_DEPTH)
      return {
        ok: false,
        error: `max recursion depth (${MAX_SCRIPT_DEPTH}) exceeded`,
      };
    const content = await fs.readFile(resolved);
    if (content === null) return { ok: false, error: `ENOENT: ${resolved}` };
    const lines = content.split('\n');
    const result = await execScriptLines(lines, 0, lines.length, cout, depth);
    if (!result.ok)
      return {
        ok: false,
        error: `script ${resolved} line ${result.failedLine}: ${result.error}`,
      };
    return { ok: true };
  }

  return {
    exec,
    history: history as readonly string[],
    cwd: () => cwdRef.value,
  };
}
