import { type CmdEnv, type ShellHandler } from './types';

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
          if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && val) vars.set(name, val);
        } else if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(a)) {
          if (!vars.has(a)) vars.set(a, '');
        }
      }
    },
    async unset(_cout, name) {
      if (!name) throw new Error('Usage: unset <name>');
      if (name === 'PATH') throw new Error('unset: PATH cannot be unset');
      vars.delete(name);
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
