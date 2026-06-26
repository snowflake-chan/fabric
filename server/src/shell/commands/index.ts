/**
 * commands — 内置命令统一管理（路由）
 *
 * 按类别拆分到独立文件，此文件仅负责合并。
 */

export {
  type Cout,
  type ShellHandler,
  type ShellResult,
  type CmdEnv,
} from './types';
export { setAllHandlers, getHandlers } from './helpers';

import { type CmdEnv, type ShellHandler } from './types';
import { Path } from '../../fs/path';
import { fsCommands } from './fs';
import { queryCommands } from './query';
import { navCommands } from './nav';
import { sysCommands } from './sys';
import { varCommands } from './vars';
import { ctrlCommands } from './ctrl';
import { edHandler } from '../ed';

export function createHandlers(env: CmdEnv): Record<string, ShellHandler> {
  const {
    fs,
    cwdRef,
    pipeInputRef,
    history,
    vars,
    getHandler,
    vfs,
    mountStorage,
    inputLine,
    execRef,
  } = env;
  const cwd = () => cwdRef.value;

  function resolve(p: string): string {
    if (!p) return cwd();
    // ~~ 展开~~ → home
    const home = vars.get('HOME');
    if (p === '~') return home || cwd();
    if (p.startsWith('~/'))
      return home ? home + p.slice(1) : Path.resolve(cwd(), p);
    return Path.resolve(cwd(), p);
  }

  return {
    ...fsCommands(env, cwd, resolve),
    ...queryCommands(env, cwd, resolve),
    ...navCommands(env, cwd, resolve),
    ...sysCommands(env, cwd, resolve),
    ...varCommands(env, cwd, resolve),
    ...ctrlCommands(env, cwd, resolve),
    ed: edHandler({ fs, cwd, inputLine }),
  };
}
