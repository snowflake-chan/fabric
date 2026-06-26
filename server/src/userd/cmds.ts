import { type ShellHandler } from '../shell/commands/types';
import { type IFileSystem } from '../fs/fabric-fs';
import { simpleHash } from './helpers';

export interface UserEnv {
  fs: IFileSystem;
  uidRef: { value: number };
  cwdRef: { value: string };
  loggedInRef: { value: boolean };
  vars: Map<string, string>;
}

function defInput(): Promise<string | undefined> {
  return new Promise(() => {});
}

export function createUserCommands(
  env: UserEnv,
  inputLine?: () => Promise<string | undefined>
): Record<string, ShellHandler> | null {
  if (!env.uidRef || !env.loggedInRef) return null;
  const { fs, uidRef, cwdRef, loggedInRef } = env;
  const il: () => Promise<string> = (inputLine ||
    defInput) as () => Promise<string>;

  // shadow 操作通过 daemon 设备（/run/userd/），走文件系统，不提权
  const shadowHash = async (user: string): Promise<string> => {
    try {
      const s = await fs.readFile('/run/userd/shadow-get');
      if (s === null) return '';
      for (const l of s.split('\n')) {
        const sp = l.split(':');
        if (sp[0] === user && sp[1]) return sp[1];
      }
    } catch {
      /* daemon 未安装，返回空 */
    }
    return '';
  };
  const verifyPass = async (user: string, pass: string): Promise<boolean> => {
    try {
      await fs.writeFile('/run/userd/verify', `${user}:${pass}`);
      const r = await fs.readFile('/run/userd/verify-result');
      return r?.trim() === 'ok';
    } catch {
      return false;
    }
  };

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
    const pw = (await il()) || '';
    if (!(await verifyPass(targetUser, pw)))
      throw new Error('su: incorrect password');
    uidRef.value = targetUid;
    cwdRef.value = home;
    await cout('');
  };

  const useradd: ShellHandler = async (cout, username) => {
    if (!username) throw new Error('Usage: useradd <username>');
    if (uidRef.value !== 0) throw new Error('useradd: only root may add users');
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
    const saved = uidRef.value;
    uidRef.value = uid;
    try {
      await fs.mkdir(home);
    } catch {}
    try {
      await fs.chmod(home, 0o755);
    } catch {}
    uidRef.value = saved;
    await fs.chown(home, uid);
    await cout(`added user ${username} (uid ${uid})`);
  };

  const userdel: ShellHandler = async (cout, username) => {
    if (!username) throw new Error('Usage: userdel <username>');
    if (uidRef.value !== 0)
      throw new Error('userdel: only root may delete users');
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
      uidRef.value !== 0 &&
      !(await fs.readFile('/etc/passwd'))
        ?.split('\n')
        .some(
          (l) =>
            l.split(':')[0] === username &&
            parseInt(l.split(':')[2]) === uidRef.value
        )
    )
      throw new Error('passwd: permission denied');
    const pw = (await il()) || '';
    if (pw.length < 2) throw new Error('passwd: password too short');
    await fs.writeFile(
      '/run/userd/shadow-set',
      `${username}:${simpleHash(pw)}\n`
    );
    await cout(`password set for ${username}`);
  };

  const login: ShellHandler = async (cout) => {
    while (true) {
      await cout('Username: ');
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
      await cout('Password: ');
      const pw = (await il()) || '';
      if (!(await verifyPass(user, pw))) {
        await cout('login: incorrect password');
        continue;
      }
      uidRef.value = uid;
      loggedInRef.value = true;
      if (home) cwdRef.value = home;
      await cout(`Welcome, ${user}`);
      return;
    }
  };

  return { whoami, id, su, useradd, userdel, passwd, login };
}
