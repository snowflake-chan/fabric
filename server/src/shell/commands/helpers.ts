import { type IFileSystem } from '../../fs/fabric-fs';
import { type ShellHandler } from './types';

export function processEscapes(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

export async function streamTree(
  fs: IFileSystem,
  dirPath: string,
  prefix: string,
  emit: (line: string) => Promise<void>
): Promise<void> {
  const entries = await fs.readdir(dirPath);
  for (let i = 0; i < entries.length; i++) {
    const isLast = i === entries.length - 1;
    const name = entries[i];
    const childPath = dirPath === '/' ? `/${name}` : `${dirPath}/${name}`;
    const st = await fs.stat(childPath);
    const connector = isLast ? '└─ ' : '├─ ';
    const display = st?.type === 'dir' ? `${name}/` : name;
    await emit(`${prefix}${connector}${display}`);
    if (st?.type === 'dir') {
      await streamTree(fs, childPath, prefix + (isLast ? '   ' : '│  '), emit);
    }
  }
}

let _allHandlers: Record<string, ShellHandler> = {};

export function setAllHandlers(h: Record<string, ShellHandler>): void {
  _allHandlers = h;
}

export function getHandlers(): Record<string, ShellHandler> {
  return _allHandlers;
}
