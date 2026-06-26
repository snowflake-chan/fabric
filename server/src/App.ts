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

// 挂载虚拟设备到 /dev
const devFs = new DevFS();

devFs.registerDevice('/dev/box/say', {
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

devFs.registerDevice('/dev/box/players', {
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

const playerJoinSock = devFs.registerSocket('/dev/box/player-join');
vfs.mount('/dev', devFs);

world.onPlayerJoin(({ entity }) => {
  playerJoinSock.push(`${entity.player.userId}\t${entity.player.name}`);
});

const { shell } = createCLI(vfs);

// 初始化 TTY bridge（服务端 → RemoteChannel → 客户端 TTY UI）
createTtyBridge(shell);

vfs.init().then(() => console.warn('✓ FabricVFS ready'));
