import { type IFileSystem } from '../../fs/fabric-fs';
import type { FabricVFS } from '../../fs/fabric-vfs';

export type Cout = (line: string) => Promise<void>;
export type ShellHandler = (cout: Cout, ...args: string[]) => Promise<void>;
export type ShellResult = { ok: true } | { ok: false; error: string };

/** 检查当前 uid 是否为 root（uidRef 不存在时视为 root，单用户模式） */
export function isRoot(uidRef?: { value: number }): boolean {
  return !uidRef || uidRef.value === 0;
}

export interface CmdEnv {
  fs: IFileSystem;
  vfs?: FabricVFS;
  cwdRef: { value: string };
  uidRef?: { value: number };
  loggedInRef?: { value: boolean };
  vars: Map<string, string>;
  pipeInputRef: { value: string | null };
  print?: (text: string) => Promise<void>;
  history: string[];
  getHandler: (name: string) => ShellHandler | undefined;
  execRef?: (
    input: string,
    cout: Cout,
    depth?: number,
    inputLine?: () => Promise<string>,
    print?: (text: string) => Promise<void>,
    requestPassword?: () => Promise<string>
  ) => Promise<ShellResult>;
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
  /** 请求密码输入（客户端隐藏输入内容） */
  requestPassword?: () => Promise<string>;
  /** 带颜色输出（hex 格式如 #6B7B8D，或 'raw' 透传） */
  colorPrint?: (text: string, color: string) => Promise<void>;
}
