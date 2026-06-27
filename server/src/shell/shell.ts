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
import { Path } from '../fs/path';
import { tokenize, splitSemicolon, parseLogical, parsePipe } from './tokenizer';
import {
  expandSubstitutions,
  execScriptLines,
  tryExecScript,
  type ScriptContext,
} from './scripts';
import { createUserCommands } from '../userd/cmds';

/** 算术求值（$(( expr )) 用） */
function evalArithmetic(expr: string, vars: Map<string, string>): number {
  const toks: string[] = [];
  let buf = '';
  for (const ch of expr) {
    if ('+-*/()%'.includes(ch)) {
      if (buf) {
        toks.push(buf);
        buf = '';
      }
      toks.push(ch);
    } else if (ch === ' ') {
      if (buf) {
        toks.push(buf);
        buf = '';
      }
    } else buf += ch;
  }
  if (buf) toks.push(buf);

  const vals: number[] = [];
  const ops: string[] = [];
  const prec: Record<string, number> = {
    '+': 1,
    '-': 1,
    '*': 2,
    '/': 2,
    '%': 2,
  };

  function apply(): void {
    const op = ops.pop()!;
    const b = vals.pop()!;
    const a = vals.pop()!;
    if (op === '+') vals.push(a + b);
    else if (op === '-') vals.push(a - b);
    else if (op === '*') vals.push(a * b);
    else if (op === '/') vals.push(b === 0 ? 0 : Math.floor(a / b));
    else if (op === '%') vals.push(b === 0 ? 0 : a % b);
  }

  for (const t of toks) {
    if (t === '(') {
      ops.push(t);
    } else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') apply();
      ops.pop();
    } else if (t in prec) {
      while (
        ops.length &&
        ops[ops.length - 1] !== '(' &&
        prec[ops[ops.length - 1]] >= prec[t]
      )
        apply();
      ops.push(t);
    } else {
      const v = vars.has(t) ? parseInt(vars.get(t)!) : parseInt(t);
      vals.push(isNaN(v) ? 0 : v);
    }
  }
  while (ops.length) apply();
  return vals[0] || 0;
}

export type { Cout };
export type { ShellResult };

export function createShell(
  fs: IFileSystem,
  vfs?: FabricVFS,
  mountStorage?: (path: string, storageId: string) => Promise<void>,
  uidRef?: { value: number },
  extraHandlers?: Record<string, ShellHandler>,
  /** 共享的 RootFS uidRef，handlers 直接用它 */
  sharedUidRef?: { value: number },
  /** 特权 RootFS（uid 永远 0），影子操作不走共享 uidRef 提权 */
  privFs?: IFileSystem
) {
  const cwdRef = { value: '/' };
  const hasUsers = !!uidRef || !!sharedUidRef;
  if (!uidRef) uidRef = { value: 0 };
  // 每个 shell 用自己的 uidRef，RootFS 用 sharedUidRef（exec 入口同步）
  const shellUidRef = uidRef;
  const loggedInRef = hasUsers ? { value: false } : undefined;
  const history: string[] = [];
  const MAX_HISTORY = 100;
  const vars = new Map<string, string>();
  vars.set('PATH', '/bin');
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

  const MAX_TASKS = 50;

  function addTask(name: string, promise: Promise<unknown>): number {
    const id = nextTaskId++;
    const task: Task = { id, name, status: 'running', cancelled: false };
    tasks.push(task);
    if (tasks.length > MAX_TASKS) {
      const done = tasks.filter((t) => t.status !== 'running');
      if (done.length > 0) tasks.splice(0, done.length);
    }
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
    uidRef: shellUidRef,
    loggedInRef,
    vars,
    pipeInputRef,
    history,
    tasksRef,
    getHandler: (n) => handlers[n],
    mountStorage,
    inputLine: () => currentInputLine?.(),
    print: async (text) => {
      if (currentPrint) await currentPrint(text);
    },
    requestPassword: async () => {
      if (currentRequestPassword) return currentRequestPassword();
      return '';
    },
    colorPrint: async (text, color) => {
      if (currentColorPrint) await currentColorPrint(text, color);
    },
    execRef: exec,
  });
  if (hasUsers) {
    const userCmds = createUserCommands(
      {
        fs,
        uidRef: shellUidRef,
        cwdRef,
        loggedInRef: loggedInRef!,
        vars,
        print: async (t) => {
          if (currentPrint) await currentPrint(t);
        },
        requestPassword: async () => {
          if (currentRequestPassword) return currentRequestPassword();
          return '';
        },
        execRef: exec,
        privFs: privFs || fs,
      },
      () => Promise.resolve(currentInputLine?.())
    );
    if (userCmds) Object.assign(handlers, userCmds);
  }
  if (extraHandlers) Object.assign(handlers, extraHandlers);
  setAllHandlers(handlers);

  let currentInputLine: (() => Promise<string>) | undefined;
  let currentPrint: ((text: string) => Promise<void>) | undefined;
  let currentRequestPassword: (() => Promise<string>) | undefined;
  let currentColorPrint:
    | ((text: string, color: string) => Promise<void>)
    | undefined;

  // 脚本上下文
  const scriptCtx: ScriptContext = {
    fs,
    cwdRef,
    vars,
    uidRef: shellUidRef,
    exec,
    tokenize,
  };

  async function exec(
    input: string,
    cout: Cout,
    depth = 0,
    inputLine?: () => Promise<string>,
    print?: (text: string) => Promise<void>,
    requestPassword?: () => Promise<string>,
    colorPrint?: (text: string, color: string) => Promise<void>,
    quietInputLine?: () => Promise<string>
  ): Promise<ShellResult> {
    if (inputLine !== undefined) currentInputLine = inputLine;
    if (print !== undefined) currentPrint = print;
    if (requestPassword !== undefined) currentRequestPassword = requestPassword;
    if (colorPrint !== undefined) currentColorPrint = colorPrint;
    // 同步 RootFS 权限上下文
    if (sharedUidRef) sharedUidRef.value = shellUidRef.value;
    const trimmed = input.trim();
    if (!trimmed) return { ok: true };

    // 未登录 → 自动进入登录流程
    if (shellUidRef.value === -1 && trimmed !== 'login')
      return exec('login', cout, depth, inputLine, print, requestPassword);

    // & 后台任务（非 &&）
    if (trimmed.endsWith('&') && !trimmed.endsWith('&&')) {
      const cmd = trimmed.slice(0, -1).trimEnd();
      const taskName = cmd.length > 40 ? `${cmd.slice(0, 40)}…` : cmd;
      addTask(taskName, exec(cmd, cout, depth, inputLine));
      await cout(`[${nextTaskId - 1}] ${taskName}`);
      return { ok: true };
    }

    // if (!skipLoginCheck && loggedInRef && !loggedInRef.value && trimmed !== 'login') {
    //   await cout('Please login first (login)');
    //   return { ok: false, error: 'not logged in' };
    // }

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

    // 变量展开 + 算术展开
    let expandedLine = trimmed;
    if (vars.size > 0) {
      for (const [k, v] of vars)
        expandedLine = expandedLine.replaceAll(`$${k}`, v);
    }
    // $(( expr )) 算术求值
    expandedLine = expandedLine.replace(/\$\(\((.*?)\)\)/g, (_, expr) => {
      return String(evalArithmetic(expr.trim(), vars));
    });

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
      const target = Path.resolve(cwdRef.value, rawPath);
      const content = await fs.readFile(target);
      if (content === null) return { ok: false, error: `ENOENT: ${target}` };
      pipeInputRef.value = content;
      runArgs = cmdArgs
        .slice(0, inRedirIdx)
        .concat(cmdArgs.slice(inRedirIdx + 2));
    }

    // << EOF heredoc（客户端不 echo）
    const heredocIdx = runArgs.indexOf('<<');
    if (heredocIdx !== -1 && inputLine) {
      const delim = runArgs[heredocIdx + 1];
      if (!delim)
        return { ok: false, error: 'syntax error: << without delimiter' };
      const lines: string[] = [];
      const hdInput = quietInputLine || inputLine;
      while (true) {
        const l = (await hdInput()) || '';
        if (l === delim) break;
        lines.push(l);
      }
      pipeInputRef.value = lines.join('\n');
      runArgs = runArgs
        .slice(0, heredocIdx)
        .concat(runArgs.slice(heredocIdx + 2));
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

    if (hasRedirect && cmdName !== 'sudo') {
      const idx = redirectAppend ? redirIdx : redirSglIdx;
      const rawPath = runArgs[idx + 1];
      if (!rawPath || rawPath.startsWith('-'))
        return { ok: false, error: 'syntax error: redirect without target' };
      redirectTarget = Path.resolve(cwdRef.value, rawPath);
      runArgs = runArgs.slice(0, idx).concat(runArgs.slice(idx + 2));
      runCout = async (l) => {
        captured.push(l);
      };
    }

    const handler = handlers[cmdName];
    if (!handler) {
      // PATH 查找（仅纯命令名，含 / 或 . 的直接走 tryExecScript）
      if (!cmdName.includes('/') && !cmdName.startsWith('.')) {
        const pathDirs = (vars.get('PATH') || '/bin').split(':');
        for (const dir of pathDirs) {
          const sp = `${dir}/${cmdName}`;
          const r = await tryExecScript(sp, runArgs, runCout, depth, scriptCtx);
          if (r !== null) {
            await writeRedirect();
            return r;
          }
        }
      }
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
    uid: () => shellUidRef.value,
    user: async () => {
      if (shellUidRef.value === 0) return 'root';
      if (shellUidRef.value < 0) return 'nobody';
      const pwd = await fs.readFile('/etc/passwd');
      if (pwd !== null) {
        for (const l of pwd.split('\n')) {
          const p = l.split(':');
          if (p.length >= 3 && parseInt(p[2]) === shellUidRef.value)
            return p[0];
        }
      }
      return String(shellUidRef.value);
    },
  };
}
