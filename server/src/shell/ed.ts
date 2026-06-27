/**
 * ed — 行编辑器
 *
 * 用法：ed <file>
 *   打开文件进入交互模式，通过 inputLine() 读取用户输入。
 *
 * 命令：
 *   n       跳转到第 n 行
 *   p       打印当前行（n p 打印第 n 行，1,$p 打印全部）
 *   n       带行号打印
 *   =       打印行数
 *   a       追加（. 结束）
 *   i       插入（. 结束）
 *   d       删除
 *   s/old/new/  替换
 *   w       保存
 *   q       退出
 *   wq      保存并退出
 */

import { Path } from '../fs/path';

type Cout = (line: string) => Promise<void>;
type ShellHandler = (cout: Cout, ...args: string[]) => Promise<void>;

import { type IFileSystem } from '../fs/fabric-fs';

interface EdEnv {
  fs: IFileSystem;
  cwd: () => string;
  inputLine?: () => Promise<string> | undefined;
}

export function edHandler(env: EdEnv): ShellHandler {
  return async (cout, filePath) => {
    if (!filePath) throw new Error('Usage: ed <file>');
    const { fs, cwd } = env;
    const { inputLine } = env;
    if (!inputLine) throw new Error('ed: interactive input not available');
    const fileName = Path.resolve(cwd(), filePath);

    // 读取文件到缓冲区
    const buf: string[] = [];
    const MAX_BUF = 100000;
    const existing = await fs.readFile(fileName);
    if (existing !== null) {
      const lines = existing.split('\n');
      for (const l of lines) buf.push(l);
      if (buf.length > 0 && buf[buf.length - 1] === '') buf.pop();
    }

    let cur = buf.length;
    let modified = false;
    if (buf.length > 0) await cout(String(buf.length));

    while (true) {
      const raw = ((await inputLine()) || '').trim();
      if (!raw) continue;

      // wq = 保存并退出
      if (raw === 'wq') {
        await fs.writeFile(fileName, `${buf.join('\n')}\n`);
        return;
      }

      const m = raw.match(/^([.,$0-9]*)([a-zA-Z=]?)(.*)$/);
      if (!m) {
        await cout('?');
        continue;
      }

      const addrStr = m[1];
      const cmd = m[2];
      const cmdArg = m[3].trim();

      function parseAddr(s: string): { start: number; end: number } | null {
        if (!s) return { start: cur, end: cur };
        s = s.replace(/\$/g, String(buf.length));
        s = s.replace(/\./g, String(cur));
        const parts = s.split(',');
        if (parts.length === 2) {
          const a = parts[0] ? parseInt(parts[0]) : 1;
          const b = parts[1] ? parseInt(parts[1]) : buf.length;
          if (isNaN(a) || isNaN(b)) return null;
          return {
            start: Math.max(1, Math.min(a, buf.length || 1)),
            end: Math.max(1, Math.min(b, buf.length || 1)),
          };
        }
        if (parts.length === 1 && parts[0]) {
          const n = parseInt(parts[0]);
          if (isNaN(n)) return null;
          return {
            start: Math.max(1, Math.min(n, buf.length || 1)),
            end: Math.max(1, Math.min(n, buf.length || 1)),
          };
        }
        return { start: cur, end: cur };
      }

      if (!cmd) {
        if (addrStr === '' || addrStr === ',') {
          for (let i = 0; i < buf.length; i++) await cout(buf[i]);
          continue;
        }
        if (/^\d+$/.test(addrStr)) {
          const n = parseInt(addrStr);
          if (n < 1 || n > buf.length) {
            await cout('?');
            continue;
          }
          cur = n;
          if (buf[cur - 1] !== undefined) await cout(buf[cur - 1]);
          continue;
        }
        await cout('?');
        continue;
      }

      const addr = parseAddr(addrStr);

      switch (cmd) {
        case 'p': {
          if (!addr) {
            await cout('?');
            break;
          }
          for (let i = addr.start; i <= addr.end; i++) {
            if (buf[i - 1] !== undefined) await cout(buf[i - 1]);
          }
          cur = addr.end;
          break;
        }
        case 'n': {
          if (!addr) {
            await cout('?');
            break;
          }
          for (let i = addr.start; i <= addr.end; i++) {
            if (buf[i - 1] !== undefined) await cout(`${i}\t${buf[i - 1]}`);
          }
          cur = addr.end;
          break;
        }
        case '=': {
          if (addrStr && !addrStr.includes(',')) {
            const n = parseInt(addrStr.replace(/\$/g, String(buf.length)));
            await cout(String(isNaN(n) ? buf.length : n));
          } else {
            await cout(String(buf.length));
          }
          break;
        }
        case 'c': {
          const at = addr ? addr.start : cur;
          const lines: string[] = [];
          while (true) {
            if (buf.length + lines.length >= MAX_BUF) {
              await cout('?MAXBUF');
              break;
            }
            const l = await inputLine();
            if (l === '.' || l === undefined) break;
            lines.push(l);
          }
          buf.splice(at - 1, addr ? addr.end - addr.start + 1 : 1, ...lines);
          cur = at + lines.length - 1;
          modified = true;
          break;
        }
        case 'a': {
          const at = addr ? addr.end : cur;
          let cnt = 0;
          while (true) {
            if (buf.length >= MAX_BUF) {
              await cout('?MAXBUF');
              break;
            }
            const l = await inputLine();
            if (l === '.' || l === undefined) break;
            buf.splice(at + cnt, 0, l);
            cnt++;
          }
          cur = at + cnt;
          modified = true;
          break;
        }
        case 'i': {
          const at = addr ? addr.start - 1 : cur - 1;
          let cnt = 0;
          while (true) {
            if (buf.length >= MAX_BUF) {
              await cout('?MAXBUF');
              break;
            }
            const l = await inputLine();
            if (l === '.' || l === undefined) break;
            buf.splice(at + cnt, 0, l);
            cnt++;
          }
          cur = at + cnt;
          modified = true;
          break;
        }
        case 'd': {
          if (!addr) {
            await cout('?');
            break;
          }
          buf.splice(addr.start - 1, addr.end - addr.start + 1);
          cur = Math.min(addr.start, buf.length || 1);
          modified = true;
          break;
        }
        case 's': {
          if (!cmdArg) {
            await cout('?');
            break;
          }
          const sep = cmdArg[0];
          const sepIdx = cmdArg.lastIndexOf(sep);
          if (sepIdx <= 0) {
            await cout('?');
            break;
          }
          const oldPat = cmdArg.slice(1, sepIdx);
          const newPat = cmdArg.slice(sepIdx + 1);
          const tl = addr ? addr.end : cur;
          if (tl >= 1 && tl <= buf.length) {
            buf[tl - 1] = buf[tl - 1].replace(oldPat, newPat);
            modified = true;
          }
          break;
        }
        case 'w': {
          const outPath = cmdArg ? Path.resolve(cwd(), cmdArg) : fileName;
          await fs.writeFile(outPath, `${buf.join('\n')}\n`);
          await cout(String(buf.length));
          modified = false;
          break;
        }
        case 'q': {
          if (modified) {
            await cout('?');
            continue;
          }
          return;
        }
        default:
          await cout('?');
      }
    }
  };
}
