import { type IFileSystem } from '../../fs/fabric-fs';
import { type CmdEnv, type ShellHandler } from './types';

/** 从 profile 中移除 export 行 */
async function removeExport(
  fs: IFileSystem,
  profilePath: string,
  name: string
): Promise<void> {
  const existing = (await fs.readFile(profilePath)) || '';
  const lines = existing.split('\n').filter(Boolean);
  const filtered = lines.filter(
    (l) => !l.match(new RegExp(`^export\\s+${name}=`))
  );
  if (filtered.length !== lines.length)
    await fs.writeFile(profilePath, `${filtered.join('\n')}\n`);
}

/** 持久化 export 到 profile 文件 */
async function persistExport(
  fs: IFileSystem,
  profilePath: string,
  name: string,
  val: string
): Promise<void> {
  const existing = (await fs.readFile(profilePath)) || '';
  const lines = existing.split('\n').filter(Boolean);
  const newLine = `export ${name}=${val}`;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(new RegExp(`^export\\s+${name}=`))) {
      lines[i] = newLine;
      found = true;
      break;
    }
  }
  if (!found) lines.push(newLine);
  await fs.writeFile(profilePath, `${lines.join('\n')}\n`);
}

export function varCommands(
  env: CmdEnv,
  _cwd: () => string,
  _resolve: (p: string) => string
): Record<string, ShellHandler> {
  const { vars, inputLine, execRef } = env;
  return {
    ['export']: async (cout, ...args) => {
      if (args.length === 0) {
        for (const [k, v] of vars) await cout(`export ${k}=${v}`);
        return;
      }
      for (const a of args) {
        const eq = a.indexOf('=');
        if (eq !== -1) {
          const name = a.slice(0, eq);
          const val = a.slice(eq + 1);
          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && val) {
            vars.set(name, val);
            // 持久化到 ~/.profile
            const home = vars.get('HOME');
            if (home) {
              const profilePath = `${home}/.profile`;
              persistExport(env.fs, profilePath, name, val).catch(() => {});
            }
          }
        } else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(a)) {
          if (!vars.has(a)) vars.set(a, '');
        }
      }
    },
    async unset(_cout, name) {
      if (!name) throw new Error('Usage: unset <name>');
      vars.delete(name);
      // 同时从 profile 中移除
      const home = vars.get('HOME');
      if (home) {
        const profilePath = `${home}/.profile`;
        removeExport(env.fs, profilePath, name).catch(() => {});
      }
    },
    async env(cout) {
      for (const k of Array.from(vars.keys()).sort())
        await cout(`${k}=${vars.get(k)}`);
    },
    async read(_cout, varname) {
      if (!varname) throw new Error('Usage: read <varname>');
      const line = (await inputLine!()) || '';
      vars.set(varname, line);
    },
    async source(cout, path) {
      if (!path) throw new Error('Usage: source <file>');
      if (!execRef) throw new Error('source: execRef not available');
      const content = await env.fs.readFile(_resolve(path));
      if (content === null) throw new Error(`ENOENT: ${path}`);
      for (const line of content.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const r = await execRef(t, cout, 0);
        if (!r.ok) throw new Error(r.error);
      }
    },
  };
}
