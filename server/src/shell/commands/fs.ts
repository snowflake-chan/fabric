import { type CmdEnv, type ShellHandler, isRoot } from './types';
import { Path } from '../../fs/path';
import { processEscapes } from './helpers';

export function fsCommands(
  env: CmdEnv,
  cwd: () => string,
  resolve: (p: string) => string
): Record<string, ShellHandler> {
  const { fs } = env;
  return {
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
      if (!path && env.pipeInputRef.value !== null) {
        for (const l of env.pipeInputRef.value.split('\n')) await cout(l);
        return;
      }
      const target = resolve(path);
      const content = await fs.readFile(target);
      if (content === null) throw new Error(`ENOENT: ${target}`);
      for (const l of content.split('\n')) await cout(l);
    },
    async chmod(_cout, ...args) {
      if (args.length < 2) throw new Error('Usage: chmod <mode> <path>');
      const target = resolve(args[1]);
      let mode: number;
      if (/^\d{3}$/.test(args[0])) mode = parseInt(args[0], 8);
      else if (args[0] === '+x') {
        const st = await fs.stat(target);
        if (st === null) throw new Error(`ENOENT: ${target}`);
        mode = st.mode | 0o111;
      } else if (args[0] === '-x') {
        const st = await fs.stat(target);
        if (st === null) throw new Error(`ENOENT: ${target}`);
        mode = st.mode & ~0o111;
      } else throw new Error(`chmod: invalid mode '${args[0]}'`);
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
        } else paths.push(a);
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
    async chown(cout, owner, path) {
      if (!owner || !path) throw new Error('Usage: chown <user> <path>');
      if (!isRoot(env.uidRef))
        throw new Error('chown: only root may change ownership');
      let uid = NaN;
      const pwd = await fs.readFile('/etc/passwd');
      if (pwd !== null) {
        for (const l of pwd.split('\n')) {
          const p = l.split(':');
          if (p[0] === owner) {
            uid = parseInt(p[2]);
            break;
          }
        }
      }
      if (isNaN(uid)) throw new Error(`chown: unknown user: ${owner}`);
      await fs.chown(resolve(path), uid);
    },

    async touch(_cout, path) {
      const target = resolve(path);
      const st = await fs.stat(target);
      if (st === null) await fs.writeFile(target, '');
    },
  };
}
