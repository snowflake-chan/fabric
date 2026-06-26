/**
 * DebugShell — FabricFS shell（纯逻辑层）
 *
 * 解析命令字符串 → 逐行输出（cout）→ 返回成功/失败状态
 * 命令 handler 在 commands/ 中统一管理。
 */

import { type IFileSystem } from '../fs/fabric-fs';
import { type FabricVFS } from '../fs/fabric-vfs';
import {
  type Cout,
  type ShellResult,
  type ShellHandler,
  createHandlers,
  setAllHandlers,
} from './commands/index';
import { tokenize, splitSemicolon, parseLogical, parsePipe } from './tokenizer';
import {
  expandSubstitutions,
  execScriptLines,
  tryExecScript,
  type ScriptContext,
} from './scripts';
import { createUserCommands } from '../userd/cmds';
import { type UserEnv } from '../userd/cmds';

export type { Cout };
export type { ShellResult };

export function createShell(
  fs: IFileSystem,
  vfs?: FabricVFS,
  mountStorage?: (path: string, storageId: string) => Promise<void>,
  uidRef?: { value: number },
  extraHandlers?: Record<string, ShellHandler>
) {
  const cwdRef = { value: '/' };
  const hasUsers = !!uidRef;
  if (!uidRef) uidRef = { value: 0 };
  const loggedInRef = hasUsers ? { value: false } : undefined;
  const history: string[] = [];
  const MAX_HISTORY = 100;
  const vars = new Map<string, string>();
  const pipeInputRef = { value: null as string | null };

  // ---- 任务管理 -----------------------------------------------------------

  interface Task {
    id: number;
    name: string;
    status: 'running' | 'completed' | 'failed';
    cancelled: boolean;
  }
  const tasks: Task[] = [];
  let nextTaskId = 1;
  const tasksRef = {
    get list() {
      return tasks;
    },
  };

  function addTask(name: string, promise: Promise<unknown>): number {
    const id = nextTaskId++;
    const task: Task = { id, name, status: 'running', cancelled: false };
    tasks.push(task);
    promise.then(
      () => {
        task.status = 'completed';
      },
      () => {
        task.status = 'failed';
      }
    );
    return id;
  }

  const handlers = createHandlers({
    fs,
    vfs,
    cwdRef,
    uidRef,
    loggedInRef,
    vars,
    pipeInputRef,
    history,
    tasksRef,
    getHandler: (n) => handlers[n],
    mountStorage,
    inputLine: () => currentInputLine?.(),
    execRef: exec,
  });
  if (hasUsers) {
    const userCmds = createUserCommands(
      { fs, uidRef, cwdRef, loggedInRef: loggedInRef!, vars },
      () => Promise.resolve(currentInputLine?.())
    );
    if (userCmds) Object.assign(handlers, userCmds);
  }
  if (extraHandlers) Object.assign(handlers, extraHandlers);
  setAllHandlers(handlers);

  let currentInputLine: (() => Promise<string>) | undefined;

  // 脚本上下文
  const scriptCtx: ScriptContext = {
    fs,
    cwdRef,
    vars,
    uidRef,
    exec,
    tokenize,
  };

  async function exec(
    input: string,
    cout: Cout,
    depth = 0,
    inputLine?: () => Promise<string>
  ): Promise<ShellResult> {
    currentInputLine = inputLine;
    const trimmed = input.trim();
    if (!trimmed) return { ok: true };

    // & 后台任务（非 &&）
    if (trimmed.endsWith('&') && !trimmed.endsWith('&&')) {
      const cmd = trimmed.slice(0, -1).trimEnd();
      const taskName = cmd.length > 40 ? `${cmd.slice(0, 40)}…` : cmd;
      addTask(taskName, exec(cmd, cout, depth, inputLine));
      await cout(`[${nextTaskId - 1}] ${taskName}`);
      return { ok: true };
    }

    if (loggedInRef && !loggedInRef.value && trimmed !== 'login') {
      await cout('Please login first (login)');
      return { ok: false, error: 'not logged in' };
    }

    const expanded =
      trimmed === '!!' ? (history[history.length - 1] ?? '') : trimmed;
    if (trimmed === '!!') {
      if (!expanded) return { ok: false, error: 'no previous command' };
      await cout(expanded);
    }

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
        const thenBody = em ? em[1] : rest,
          elseBody = em ? em[2] : null;
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
        for (let iter = 0; iter < 10000 && iter < words.length; iter++) {
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
        for (let iter = 0; iter < 10000; iter++) {
          const cr = await exec(condition, cout, depth);
          if (!cr.ok) break;
          const r = await exec(body, cout, depth);
          if (!r.ok) return r;
        }
        return { ok: true };
      }
      return execScriptLines([expanded], 0, 1, cout, depth, scriptCtx);
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
            ? async (l) => {
                captured.push(l);
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

    // 变量赋值
    const assignMatch = rawName?.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/);
    if (assignMatch) {
      const [, varName, varValue] = assignMatch;
      if (cmdArgs.length === 0) {
        vars.set(varName, varValue);
        return { ok: true };
      }
      const oldVal = vars.get(varName);
      vars.set(varName, varValue);
      const r = await exec(cmdArgs.join(' '), cout, depth);
      if (oldVal !== undefined) vars.set(varName, oldVal);
      else vars.delete(varName);
      return r;
    }

    // < 重定向
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
      const content = captured.join('\n');
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
      runCout = async (l) => {
        captured.push(l);
      };
    }

    const handler = handlers[cmdName];
    if (!handler) {
      const scriptResult = await tryExecScript(
        cmdName,
        runArgs,
        runCout,
        depth,
        scriptCtx
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
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    exec,
    history: history as readonly string[],
    cwd: () => cwdRef.value,
  };
}
