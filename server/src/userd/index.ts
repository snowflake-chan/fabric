/**
 * userd — 多用户模块
 *
 * 可选的用户管理系统。不引入此模块时，shell 以 root 单用户模式运行。
 *
 * 用法（在 App.ts 中）：
 *   import { createUserCommands } from './userd';
 *   const userCmds = createUserCommands({ fs, uidRef, loggedInRef, cwdRef, vars, inputLine });
 *   createCLI(vfs, vfs, mountExternalStorage, uidRef, userCmds ?? undefined);
 */

export { createUserCommands } from './cmds';
export { simpleHash } from './helpers';
