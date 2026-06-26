import {
  type ShellHandler,
  type ShellResult,
  type Cout,
  isRoot,
} from '../shell/commands/types';
import { type IFileSystem } from '../fs/fabric-fs';
import { hashPassword, verifyPassword } from './helpers';

export interface UserEnv {
  fs: IFileSystem;
  uidRef: { value: number };
  cwdRef: { value: string };
  loggedInRef: { value: boolean };
  vars: Map<string, string>;
  print?: (text: string) => Promise<void>;
  requestPassword?: () => Promise<string>;
  execRef?: (
    input: string,
    cout: Cout,
    depth?: number,
    inputLine?: () => Promise<string>,
    print?: (text: string) => Promise<void>,
    requestPassword?: () => Promise<string>
  ) => Promise<ShellResult>;
  /** 特权 RootFS（uid 永远 0），用于影子操作，不提权共享 uidRef */
  privFs: IFileSystem;
}

function defInput(): Promise<string | undefined> {
  return new Promise(() => {});
}

/** 通过特权 FS 验证密码（不提权，无 race） */
async function verifyPass(
  privFs: IFileSystem,
  user: string,
  pass: string
): Promise<boolean> {
  try {
    const shadow = await privFs.readFile('/etc/shadow');
    if (shadow === null) return false;
    for (const line of shadow.split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const f0 = line.slice(0, idx);
      const f1 = line.slice(idx + 1);
      if (f0 === user && f1 && verifyPassword(pass, f1)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** 通过特权 FS 合并写入 shadow（不提权，无 race） */
async function writeShadow(
  privFs: IFileSystem,
  username: string,
  hash: string
): Promise<void> {
  const existing = (await privFs.readFile('/etc/shadow')) || '';
  const lines = existing.split('\n').filter(Boolean);
  const newLine = `${username}:${hash}`;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    const idx = lines[i].indexOf(':');
    if (idx >= 0 && lines[i].slice(0, idx) === username) {
      lines[i] = newLine;
      found = true;
      break;
    }
  }
  if (!found) lines.push(newLine);
  await privFs.writeFile('/etc/shadow', `${lines.join('\n')}\n`);
  await privFs.chmod('/etc/shadow', 0o600);
}

export function createUserCommands(
  env: UserEnv,
  inputLine?: () => Promise<string | undefined>
): Record<string, ShellHandler> | null {
  if (!env.uidRef || !env.loggedInRef) return null;
  const {
    fs,
    uidRef,
    cwdRef,
    loggedInRef,
    vars,
    print,
    requestPassword,
    execRef,
    privFs,
  } = env;
  const il: () => Promise<string> = (inputLine ||
    defInput) as () => Promise<string>;

  const whoami: ShellHandler = async (cout) => {
    const pwd = await fs.readFile('/etc/passwd');
    for (const l of (pwd ?? '').split('\n')) {
      const p = l.split(':');
      if (p.length >= 3 && parseInt(p[2]) === uidRef.value) {
        await cout(p[0]);
        return;
      }
    }
    await cout('unknown');
  };

  const id: ShellHandler = async (cout) => {
    let name: string | null = null;
    const pwd = await fs.readFile('/etc/passwd');
    if (pwd !== null)
      for (const l of pwd.split('\n')) {
        const p = l.split(':');
        if (p.length >= 3 && parseInt(p[2]) === uidRef.value) {
          name = p[0];
          break;
        }
      }
    await cout(`uid=${uidRef.value}${name ? `(${name})` : ''}`);
  };

  const su: ShellHandler = async (cout, targetUser) => {
    if (!targetUser) throw new Error('Usage: su <username>');
    const pwd = await fs.readFile('/etc/passwd');
    if (pwd === null) throw new Error('su: no users configured');
    let targetUid = -1,
      home = '/';
    for (const l of pwd.split('\n')) {
      const p = l.split(':');
      if (p.length >= 3 && p[0] === targetUser) {
        targetUid = parseInt(p[2]);
        home = p[5] || '/';
        break;
      }
    }
    if (targetUid < 0) throw new Error(`su: unknown user ${targetUser}`);
    if (print) await print('Password: ');
    const pw = (await (requestPassword ? requestPassword() : il())) || '';
    if (!(await verifyPass(privFs, targetUser, pw)))
      throw new Error('su: incorrect password');
    uidRef.value = targetUid;
    cwdRef.value = home;
    await cout('');
  };

  const sudo: ShellHandler = async (cout, ...rest) => {
    if (rest.length === 0) throw new Error('Usage: sudo <command>');
    if (!isRoot(uidRef)) {
      let userName = '';
      const pwd = await fs.readFile('/etc/passwd');
      if (pwd !== null) {
        for (const l of pwd.split('\n')) {
          const p = l.split(':');
          if (p.length >= 3 && parseInt(p[2]) === uidRef.value) {
            userName = p[0];
            break;
          }
        }
      }
      // 检查 sudoers 列表
      const list = await fs.readFile('/etc/sudoers');
      const allowed =
        list !== null && list.split('\n').some((l) => l.trim() === userName);
      if (!allowed)
        throw new Error(
          `sudo: ${userName || uidRef.value} is not in the sudoers list`
        );
      if (print)
        await print(`[sudo] password for ${userName || uidRef.value}: `);
      const pw = (await (requestPassword ? requestPassword() : il())) || '';
      if (print) await print('\n');
      if (!(await verifyPass(privFs, userName, pw)))
        throw new Error('sudo: incorrect password');
    }
    const saved = uidRef.value;
    uidRef.value = 0;
    try {
      if (execRef) await execRef(rest.join(' '), cout);
    } finally {
      uidRef.value = saved;
    }
  };

  const useradd: ShellHandler = async (cout, username) => {
    if (!username) throw new Error('Usage: useradd <username>');
    if (!isRoot(uidRef)) throw new Error('useradd: only root may add users');
    const pwd = await fs.readFile('/etc/passwd');
    const lines = pwd ? pwd.split('\n').filter(Boolean) : [];
    for (const l of lines) {
      if (l.split(':')[0] === username)
        throw new Error(`useradd: user ${username} already exists`);
    }
    let maxUid = 1000;
    for (const l of lines) {
      const u = parseInt(l.split(':')[2]);
      if (!isNaN(u) && u >= maxUid) maxUid = u + 1;
    }
    const uid = maxUid,
      home = `/home/${username}`;
    lines.push(`${username}:x:${uid}:${uid}::${home}:/bin/sh`);
    await fs.writeFile('/etc/passwd', `${lines.join('\n')}\n`);
    // 以 root 身份创建 home 目录后再 chown
    await fs.mkdir(home).catch(() => {});
    await fs.chmod(home, 0o755).catch(() => {});
    await fs.chown(home, uid);
    // 初始化 shadow 条目（! 表示无密码，不可登录）
    await writeShadow(privFs, username, '!');
    await cout(`added user ${username} (uid ${uid})`);
  };

  const userdel: ShellHandler = async (cout, username) => {
    if (!username) throw new Error('Usage: userdel <username>');
    if (!isRoot(uidRef)) throw new Error('userdel: only root may delete users');
    const pwd = await fs.readFile('/etc/passwd');
    if (pwd === null) throw new Error('userdel: no users');
    const filtered = pwd
      .split('\n')
      .filter((l) => l.split(':')[0] !== username);
    if (filtered.length === pwd.split('\n').length)
      throw new Error(`userdel: user ${username} not found`);
    await fs.writeFile('/etc/passwd', `${filtered.join('\n')}\n`);
    await cout(`deleted user ${username}`);
  };

  const passwd: ShellHandler = async (cout, username) => {
    if (!username) throw new Error('Usage: passwd <username>');
    if (
      !isRoot(uidRef) &&
      !(await fs.readFile('/etc/passwd'))
        ?.split('\n')
        .some(
          (l) =>
            l.split(':')[0] === username &&
            parseInt(l.split(':')[2]) === uidRef.value
        )
    )
      throw new Error('passwd: permission denied');
    const pw = (await (requestPassword ? requestPassword() : il())) || '';
    if (pw.length < 2) throw new Error('passwd: password too short');
    await writeShadow(privFs, username, hashPassword(pw));
    await cout(`password set for ${username}`);
  };

  const login: ShellHandler = async (cout) => {
    while (true) {
      if (print) await print('Username: ');
      const user = (await il()) || '';
      if (!user) continue;
      const pwd = await fs.readFile('/etc/passwd');
      let uid = -1;
      let home = '';
      for (const l of (pwd ?? '').split('\n')) {
        const p = l.split(':');
        if (p.length >= 3 && p[0] === user) {
          uid = parseInt(p[2]);
          home = p.length >= 6 && p[5] ? p[5] : '';
          break;
        }
      }
      if (uid < 0) {
        await cout('login: unknown user');
        continue;
      }
      if (print) await print('Password: ');
      const pw = (await (requestPassword ? requestPassword() : il())) || '';
      if (!(await verifyPass(privFs, user, pw))) {
        await cout('login: incorrect password');
        continue;
      }
      uidRef.value = uid;
      loggedInRef.value = true;
      if (home) {
        cwdRef.value = home;
        vars.set('HOME', home);
      }
      await cout(`Welcome, ${user}\n`);
      return;
    }
  };

  return { whoami, id, su, sudo, useradd, userdel, passwd, login };
}
