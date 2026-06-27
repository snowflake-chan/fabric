import { FabricFS } from '@src/fs/fabric-fs';
import { RootFS } from '@src/fs/root-fs';
import { FabricVFS } from '@src/fs/fabric-vfs';
import { DevFS } from '@src/fs/dev-fs';
import { VirtualFS } from '@src/fs/virtual-fs';
import { createCLI } from '@src/shell/cli';
import { rateLimit } from '@src/fs/rate-limiter';
import { createTtyBridge } from '@src/shell/tty-bridge';

console.clear();

// 使用 rate limiter 避免触发 GameStorage 限流
const db = rateLimit(storage.getDataStorage('fabric_fs'), {
  readsPerSec: 20,
  writesPerSec: 10,
});

// 挂载真实文件系统到 /
const uidRef = { value: 0 };
const vfs = new FabricVFS();
const realFs = new FabricFS(db);
vfs.mount('/', new RootFS(realFs, uidRef));

// 特权 RootFS（uid 永远 0），影子操作专用，不提权共享 uidRef
const privFs = new RootFS(new FabricFS(db), { value: 0 });

// 挂载设备到 /dev
const devFs = new DevFS(vfs.bus);
vfs.mount('/dev', devFs);

// 挂载 Box3 API 到 /sys
const sysFs = new VirtualFS(vfs.bus);

sysFs.registerDevice('/say', {
  stat: () => ({
    type: 'file',
    mode: 0o666,
    size: 0,
    uid: 0,
    gid: 0,
    atime: 0,
    mtime: 0,
    ctime: 0,
    nlinks: 1,
  }),
  readFile: () => '',
  writeFile: (data) => {
    world.say(data);
  },
});

sysFs.registerDevice('/players', {
  stat: () => ({
    type: 'file',
    mode: 0o666,
    size: 0,
    uid: 0,
    gid: 0,
    atime: 0,
    mtime: 0,
    ctime: 0,
    nlinks: 1,
  }),
  readFile: () => {
    const all = world.querySelectorAll('player');
    let str = '';
    for (const entity of all) {
      str += `${entity.player.userId} ${entity.player.name}\n`;
    }
    return str;
  },
  writeFile: () => {},
});

const playerJoinSock = sysFs.registerSocket('/player-join');

world.onPlayerJoin(({ entity }) => {
  playerJoinSock.push(`${entity.player.userId}\t${entity.player.name}`);
});

const tickSock = sysFs.registerSocket('/tick');

world.onTick(() => {
  tickSock.push('');
});

vfs.mount('/sys', sysFs);

// mount <path> <storageId> — 挂载任意 GameDataStorage
async function mountExternalStorage(
  path: string,
  storageId: string
): Promise<void> {
  const db = rateLimit(storage.getDataStorage(storageId), {
    readsPerSec: 20,
    writesPerSec: 10,
  });
  const realFs = new FabricFS(db);
  await realFs.init();
  vfs.mount(path, new RootFS(realFs));
}

// CLI 用自己的 uidRef（始终 root），不跟 RootFS 共享
const cliUidRef = { value: 0 };
createCLI(vfs, vfs, mountExternalStorage, cliUidRef, undefined, uidRef, privFs);

// 初始化 TTY bridge（服务端 → RemoteChannel → 客户端 TTY UI）
// 传入 uidRef 供 RootFS 权限同步
createTtyBridge(vfs, vfs, mountExternalStorage, uidRef, privFs);

vfs.init().then(async () => {
  // 初始化 root 用户
  const pwd = await privFs.readFile('/etc/passwd');
  if (pwd === null || !pwd.split('\n').some((l) => l.startsWith('root:'))) {
    await privFs.writeFile('/etc/passwd', 'root:x:0:0::/root:/bin/sh\n');
    await privFs.chmod('/etc/passwd', 0o644);
  }
  await privFs.mkdir('/root').catch(() => {});
  // 默认 profile
  const profile = await privFs.readFile('/root/.profile');
  if (profile === null) {
    await privFs.writeFile('/root/.profile', 'export PATH=/bin\n');
  }
  console.warn('✓ FabricVFS ready');
});
