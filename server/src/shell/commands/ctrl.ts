import { type CmdEnv, type ShellHandler } from './types';
import { Path } from '../../fs/path';

export function ctrlCommands(
  env: CmdEnv,
  cwd: () => string,
  _resolve: (p: string) => string
): Record<string, ShellHandler> {
  const { fs, getHandler } = env;
  return {
    async test(cout, ...args) {
      if (args.length === 0) throw new Error('test: missing operand');
      const op = args[0];
      if (op === '-f' || op === '-d' || op === '-e') {
        const target = Path.resolve(cwd(), args[1]);
        const st = await fs.stat(target);
        if (op === '-e' && st === null) throw new Error('false');
        if (op === '-f' && (st === null || st.type !== 'file'))
          throw new Error('false');
        if (op === '-d' && (st === null || st.type !== 'dir'))
          throw new Error('false');
        return;
      }
      if (op === '-n') {
        if (!args[1]) throw new Error('false');
        return;
      }
      if (op === '-z') {
        if (args[1]) throw new Error('false');
        return;
      }
      if (args.length === 3 && args[1] === '=') {
        if (args[0] !== args[2]) throw new Error('false');
        return;
      }
      if (args.length === 3 && args[1] === '!=') {
        if (args[0] === args[2]) throw new Error('false');
        return;
      }
      if (args.length === 1) {
        if (!args[0]) throw new Error('false');
        return;
      }
      throw new Error(`test: unknown operator '${op}'`);
    },
    '[': async (cout, ...args) => {
      if (args.length < 1 || args[args.length - 1] !== ']')
        throw new Error('[: missing ]');
      const testHandler = getHandler('test');
      if (testHandler) await testHandler(cout, ...args.slice(0, -1));
    },
    true: async () => {},
    false: async () => {
      throw new Error('false');
    },
  };
}
