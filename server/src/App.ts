import { FabricFS } from '@src/fs/FileSystem';
import { RootFS } from '@src/fs/RootFS';
import { FabricVFS } from '@src/fs/FabricVFS';
import { DevFS } from '@src/fs/DevFS';
import { createCLI } from '@src/shell/Cli';
import { rateLimit } from '@src/fs/RateLimiter';
import { createTtyBridge } from '@src/shell/TtyBridge';

console.clear();

// 使用 rate limiter 避免触发 GameStorage 限流
const db = rateLimit(storage.getDataStorage('fabric_fs'), {
  readsPerSec: 20,
  writesPerSec: 10,
});

// 挂载真实文件系统到 /
const vfs = new FabricVFS();
vfs.mount('/', new RootFS(new FabricFS(db)));

// 挂载设备到 /dev
const devFs = new DevFS(vfs.bus);
vfs.mount('/dev', devFs);

// 挂载 Box3 API 到 /sys
const sysFs = new DevFS(vfs.bus);

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
vfs.mount('/sys', sysFs);

world.onPlayerJoin(({ entity }) => {
  playerJoinSock.push(`${entity.player.userId}\t${entity.player.name}`);
});

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

const { shell } = createCLI(
  vfs,
  vfs,
  mountExternalStorage,
  world.onTick.bind(world)
);

// 初始化 TTY bridge（服务端 → RemoteChannel → 客户端 TTY UI）
createTtyBridge(shell);

vfs.init().then(() => console.warn('✓ FabricVFS ready'));
