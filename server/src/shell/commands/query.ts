import { type CmdEnv, type ShellHandler } from './types';
import { streamTree } from './helpers';

export function queryCommands(
  env: CmdEnv,
  cwd: () => string,
  resolve: (p: string) => string
): Record<string, ShellHandler> {
  const { fs } = env;
  return {
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
      } else if (env.pipeInputRef.value !== null) {
        input = env.pipeInputRef.value;
      } else throw new Error('grep: no input');
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
      } else if (env.pipeInputRef.value !== null) {
        input = env.pipeInputRef.value;
      } else throw new Error('head: no input');
      if (countIsChars) {
        await cout(input.slice(0, count));
      } else {
        const lines = input.split('\n');
        for (let i = 0; i < Math.min(count, lines.length); i++)
          await cout(lines[i]);
      }
    },
  };
}
