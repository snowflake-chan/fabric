/**
 * RateLimiter — 基于 token bucket 的 GameDataStorage 速率限制包装
 *
 * 用法：
 *   const raw = storage.getDataStorage('fabric_fs');
 *   const db   = rateLimit(raw, { readsPerSec: 20, writesPerSec: 10 });
 *   const fs   = new FabricFS(db);
 *
 * 原理：
 *   每个操作 consume 一个 token，token 按速率自动补充。
 *   无 token 时操作排队等待，不丢不抛。
 *   避免因批量操作（如 stress test）触发 GameStorage 的速率限制。
 */

// ---- Token Bucket ----------------------------------------------------------

class TokenBucket {
  tokens: number;
  lastRefill: number;

  constructor(
    private maxTokens: number,
    private ratePerSec: number
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  /** 补充 token */
  refill(now: number): void {
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.ratePerSec
    );
    this.lastRefill = now;
  }

  canConsume(): boolean {
    return this.tokens >= 1;
  }

  consume(): void {
    this.tokens -= 1;
  }
}

/** 等待直到可以获取一个 token */
async function waitForToken(bucket: TokenBucket): Promise<void> {
  while (true) {
    const now = Date.now();
    bucket.refill(now);
    if (bucket.canConsume()) {
      bucket.consume();
      return;
    }
    // 等 50ms 再试，避免忙等
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ---- 限流代理 --------------------------------------------------------------

export interface RateLimitOptions {
  /** 每秒最大读取次数（get / list），默认 20 */
  readsPerSec?: number;
  /** 每秒最大写入次数（set / update / remove / increment / destroy），默认 10 */
  writesPerSec?: number;
}

export function rateLimit<T>(
  storage: GameDataStorage<T>,
  options?: RateLimitOptions
): GameDataStorage<T> {
  const readsPerSec = options?.readsPerSec ?? 20;
  const writesPerSec = options?.writesPerSec ?? 10;

  const readBucket = new TokenBucket(readsPerSec, readsPerSec);
  const writeBucket = new TokenBucket(writesPerSec, writesPerSec);

  return {
    key: storage.key,
    get: (k: string) => waitForToken(readBucket).then(() => storage.get(k)),
    set: (k: string, v: T) =>
      waitForToken(writeBucket).then(() => storage.set(k, v)),
    update: (k: string, handler: (prev: ReturnValue<T>) => T) =>
      waitForToken(writeBucket).then(() => storage.update(k, handler)),
    remove: (k: string) =>
      waitForToken(writeBucket).then(() => storage.remove(k)),
    increment: (k: string, v?: number) =>
      waitForToken(writeBucket).then(() => storage.increment(k, v)),
    list: (options: ListPageOptions) =>
      waitForToken(readBucket).then(() => storage.list(options)),
    destroy: () => waitForToken(writeBucket).then(() => storage.destroy()),
  } as unknown as GameDataStorage<T>;
}
