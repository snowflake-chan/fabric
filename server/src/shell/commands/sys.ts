import { type CmdEnv, type ShellHandler } from './types';
import { getHandlers } from './helpers';
import { Path } from '../../fs/path';

export function sysCommands(
  env: CmdEnv,
  cwd: () => string,
  resolve: (p: string) => string
): Record<string, ShellHandler> {
  const { fs, vfs, cwdRef, history, mountStorage, tasksRef } = env;
  return {
    async init(cout) {
      await fs.init();
      cwdRef.value = '/';
      await cout('init ok');
    },
    async clear() {
      /* client handled */
    },
    async sleep(_cout, seconds) {
      const sec = parseFloat(seconds);
      if (isNaN(sec) || sec < 0) throw new Error('Usage: sleep <seconds>');
      await new Promise((r) => setTimeout(r, sec * 1000));
    },
    async sock(cout, subcmd, path) {
      if (subcmd === 'cat') {
        if (!path) throw new Error('Usage: sock cat <path>');
        const target = resolve(path);
        const line = await fs.readFile(target);
        if (line && line.length > 0) await cout(line);
        return;
      }
      if (subcmd === 'create') {
        if (!path) throw new Error('Usage: sock create <path>');
        if (!vfs) throw new Error('sock: VFS not available');
        vfs.registerSocket(resolve(path));
        await cout(`socket created at ${path}`);
        return;
      }
      throw new Error(`sock: unknown subcommand '${subcmd}'`);
    },
    async help(cout) {
      const names = Object.keys(getHandlers()).sort();
      for (const n of names) await cout(n);
    },
    async history(cout) {
      for (let i = 0; i < history.length; i++)
        await cout(`${i + 1}  ${history[i]}`);
    },
    async fabric(cout, flag) {
      if (flag === '-v' || flag === '--version') {
        await cout('FabricFS v0.2 -- ArenaPro virtual filesystem');
        return;
      }
      throw new Error('Usage: fabric -v');
    },
    async jobs(cout) {
      if (tasksRef)
        for (const t of tasksRef.list)
          await cout(`[${t.id}] ${t.status}  ${t.name}`);
      else await cout('no task manager');
    },
    async kill(_cout, ref) {
      if (!ref) throw new Error('Usage: kill <task-id>');
      const id = parseInt(ref.replace('%', ''));
      if (tasksRef) {
        const t = tasksRef.list.find((x) => x.id === id);
        if (t) {
          t.status = 'failed';
          t.cancelled = true;
        }
      }
    },
    async mount(cout, path, storageId) {
      if (!vfs) throw new Error('mount: not available');
      if (path && storageId) {
        if (!mountStorage) throw new Error('mount: storage not available');
        await mountStorage(Path.resolve(cwd(), path), storageId);
        await cout(`mounted ${storageId} at ${path}`);
        return;
      }
      for (const m of vfs.getMounts()) await cout(`${m.prefix}  ${m.type}`);
    },
    async unmount(_cout, prefix) {
      if (!vfs) throw new Error('unmount: not available');
      if (!prefix) throw new Error('Usage: unmount <path>');
      vfs.unmount(prefix);
    },
    async format(cout, path) {
      if (path && vfs) {
        const target = Path.resolve(cwd(), path);
        const targetFs = vfs.getFs(target);
        if (!targetFs) throw new Error(`format: no filesystem at ${target}`);
        await targetFs.format();
        if (target === cwd()) cwdRef.value = '/';
        await cout(`format ok: ${target}`);
        return;
      }
      await fs.format();
      cwdRef.value = '/';
      await cout('format ok');
    },
  };
}
