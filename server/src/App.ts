import { FabricFS } from '@src/fs/FileSystem';
import { createCLI } from '@src/fs/Cli';
import { rateLimit } from '@src/fs/RateLimiter';
import { createTtyBridge } from '@src/fs/TtyBridge';

console.clear();

// 使用 rate limiter 避免触发 GameStorage 限流
const db = rateLimit(storage.getDataStorage('fabric_fs'), {
  readsPerSec: 20,
  writesPerSec: 10,
});

const fs = new FabricFS(db);
const { shell } = createCLI(fs);

// 初始化 TTY bridge（服务端 → RemoteChannel → 客户端 TTY UI）
createTtyBridge(shell);

fs.init().then(() => console.warn('✓ FabricFS ready'));
