/**
 * scripts — 脚本执行
 */

import { type Cout, type ShellResult } from './commands/types';
import { Path } from '../fs/path';
import { type IFileSystem } from '../fs/fabric-fs';
import { type tokenize } from './tokenizer';

export interface ScriptContext {
  fs: IFileSystem;
  cwdRef: { value: string };
  vars: Map<string, string>;
  uidRef: { value: number };
  exec: (input: string, cout: Cout, depth?: number) => Promise<ShellResult>;
  tokenize: typeof tokenize;
}

const MAX_SCRIPT_DEPTH = 10;
const MAX_LOOP_ITERATIONS = 10000;

/** 命令替换 $(...) */
export async function expandSubstitutions(
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

/** 找块结束 */
export function findBlockEnd(
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
    } else if (line === 'else' && depth === 0 && elseIdx === null) elseIdx = i;
  }
  return { endIdx: lines.length, elseIdx };
}

/** 执行多行脚本 */
export async function execScriptLines(
  lines: string[],
  startIdx: number,
  endIdx: number,
  cout: Cout,
  depth: number,
  ctx: ScriptContext
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
        const r = await ctx.exec(line, cout, depth + 1);
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
      const cr = await ctx.exec(condition, cout, depth + 1);
      if (cr.ok) {
        const r = await execScriptLines(
          lines,
          i,
          block.elseIdx ?? block.endIdx,
          cout,
          depth,
          ctx
        );
        if (!r.ok) return r;
      } else if (block.elseIdx !== null) {
        const r = await execScriptLines(
          lines,
          block.elseIdx + 1,
          block.endIdx,
          cout,
          depth,
          ctx
        );
        if (!r.ok) return r;
      }
      i = block.endIdx + 1;
      continue;
    }

    if (line.startsWith('for ')) {
      if (/;\s*done(?:\s|$)/.test(line)) {
        const r = await ctx.exec(line, cout, depth + 1);
        if (!r.ok) return r;
        i++;
        continue;
      }
      const parts = line.slice(4).trim().split(/\s+/);
      const varname = parts[0],
        inIdx = parts.indexOf('in');
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
      const oldVal = ctx.vars.get(varname);
      for (
        let iter = 0;
        iter < MAX_LOOP_ITERATIONS && iter < words.length;
        iter++
      ) {
        ctx.vars.set(varname, words[iter]);
        const r = await execScriptLines(
          lines,
          i,
          block.endIdx,
          cout,
          depth,
          ctx
        );
        if (!r.ok) return r;
      }
      if (oldVal !== undefined) ctx.vars.set(varname, oldVal);
      else ctx.vars.delete(varname);
      i = block.endIdx + 1;
      continue;
    }

    if (line.startsWith('while ')) {
      if (/;\s*done(?:\s|$)/.test(line)) {
        const r = await ctx.exec(line, cout, depth + 1);
        if (!r.ok) return r;
        i++;
        continue;
      }
      let condition = line.slice(6).trim();
      if (condition.endsWith('; do')) condition = condition.slice(0, -4).trim();
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
        const cr = await ctx.exec(condition, cout, depth + 1);
        if (!cr.ok) break;
        const r = await execScriptLines(
          lines,
          i,
          block.endIdx,
          cout,
          depth,
          ctx
        );
        if (!r.ok) return r;
      }
      i = block.endIdx + 1;
      continue;
    }

    const r = await ctx.exec(line, cout, depth + 1);
    if (!r.ok) return { ok: false, error: r.error, failedLine: i };
  }
  return { ok: true };
}

/** 执行脚本文件 */
export async function tryExecScript(
  cmdName: string,
  args: string[],
  cout: Cout,
  depth: number,
  ctx: ScriptContext
): Promise<ShellResult | null> {
  if (!cmdName.includes('/') && !cmdName.startsWith('.')) return null;
  const resolved = cmdName.startsWith('/')
    ? cmdName
    : Path.resolve(ctx.cwdRef.value, cmdName);
  const st = await ctx.fs.stat(resolved);
  if (st === null) return { ok: false, error: `ENOENT: ${resolved}` };
  if (st.type !== 'file') return { ok: false, error: `EISDIR: ${resolved}` };
  if ((st.mode & 0o111) === 0)
    return { ok: false, error: `EACCES: ${resolved}` };
  if (depth >= MAX_SCRIPT_DEPTH)
    return {
      ok: false,
      error: `max recursion depth (${MAX_SCRIPT_DEPTH}) exceeded`,
    };

  const content = await ctx.fs.readFile(resolved);
  if (content === null) return { ok: false, error: `ENOENT: ${resolved}` };

  // .js 文件 → 用 V8 执行
  if (resolved.endsWith('.js')) {
    try {
      const fn = new Function(
        'cout',
        'args',
        'fs',
        'vars',
        'cwd',
        'uid',
        content
      );
      await fn(cout, args, ctx.fs, ctx.vars, ctx.cwdRef, ctx.uidRef);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: `JS Error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  const oldArgs = ctx.vars.get('@');
  const oldArgv: string[] = [];
  for (let i = 1; i <= args.length; i++) {
    const k = String(i);
    const old = ctx.vars.get(k);
    if (old !== undefined) oldArgv[i] = old;
    ctx.vars.set(k, args[i - 1]);
  }
  ctx.vars.set('#', String(args.length));
  ctx.vars.set('@', args.join(' '));

  const lines = content.split('\n');
  const result = await execScriptLines(
    lines,
    0,
    lines.length,
    cout,
    depth,
    ctx
  );

  for (let i = 1; i <= args.length; i++) {
    const k = String(i);
    if (oldArgv[i] !== undefined) ctx.vars.set(k, oldArgv[i]);
    else ctx.vars.delete(k);
  }
  if (oldArgs !== undefined) ctx.vars.set('@', oldArgs);
  else ctx.vars.delete('@');
  ctx.vars.delete('#');

  if (!result.ok)
    return {
      ok: false,
      error: `script ${resolved} line ${result.failedLine}: ${result.error}`,
    };
  return { ok: true };
}
