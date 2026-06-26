import { FabricFS } from '@src/fs/FileSystem';
import { FabricVFS } from '@src/fs/FabricVFS';
import { createCLI } from '@src/shell/Cli';
import { rateLimit } from '@src/fs/RateLimiter';
import { createTtyBridge } from '@src/shell/TtyBridge';

console.clear();

// 使用 rate limiter 避免触发 GameStorage 限流
const db = rateLimit(storage.getDataStorage('fabric_fs'), {
  readsPerSec: 20,
  writesPerSec: 10,
});

const realFs = new FabricFS(db);
const fs = new FabricVFS(realFs);

fs.registerDevice('/dev/box/say', {
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

const { shell } = createCLI(fs);

// 初始化 TTY bridge（服务端 → RemoteChannel → 客户端 TTY UI）
createTtyBridge(shell);

fs.init().then(() => console.warn('✓ FabricVFS ready'));
