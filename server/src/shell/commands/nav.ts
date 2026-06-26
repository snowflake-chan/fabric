import { type CmdEnv, type ShellHandler } from './types';

export function navCommands(
  env: CmdEnv,
  cwd: () => string,
  resolve: (p: string) => string
): Record<string, ShellHandler> {
  const { fs, cwdRef } = env;
  return {
    async cd(_cout, path) {
      if (path === undefined) return;
      const target = resolve(path);
      const st = await fs.stat(target);
      if (st === null) throw new Error(`ENOENT: ${target}`);
      if (st.type !== 'dir')
        throw new Error(`ENOTDIR: ${target} is not a directory`);
      cwdRef.value = target;
    },
    async pwd(cout) {
      await cout(cwd());
    },
  };
}
