import { type IFileSystem } from '../../fs/fabric-fs';
import type { FabricVFS } from '../../fs/fabric-vfs';

export type Cout = (line: string) => Promise<void>;
export type ShellHandler = (cout: Cout, ...args: string[]) => Promise<void>;
export type ShellResult = { ok: true } | { ok: false; error: string };

export interface CmdEnv {
  fs: IFileSystem;
  vfs?: FabricVFS;
  cwdRef: { value: string };
  uidRef?: { value: number };
  loggedInRef?: { value: boolean };
  vars: Map<string, string>;
  pipeInputRef: { value: string | null };
  history: string[];
  getHandler: (name: string) => ShellHandler | undefined;
  execRef?: (input: string, cout: Cout, depth?: number) => Promise<ShellResult>;
  tasksRef?: {
    list: Array<{
      id: number;
      name: string;
      status: string;
      cancelled?: boolean;
    }>;
  };
  mountStorage?: (path: string, storageId: string) => Promise<void>;
  inputLine?: () => Promise<string> | undefined;
}
