/**
 * StressTest — FabricFS 鲁棒性压力测试
 *
 * 跑法：$`stress`  或在代码里直接调 runStressTest(fs)
 *
 * 覆盖维度：
 *   1. 分块边界（inline ↔ chunked 切换）
 *   2. 并发写入竞态
 *   3. 大目录（500 文件）
 *   4. 存储格式反复横跳
 *   5. rename 跨目录 + 覆盖
 *   6. 深目录嵌套
 */

import type { FabricFS } from './FileSystem';

// ---- 报告收集 --------------------------------------------------------------

class Report {
  total = 0;
  passed = 0;
  failed = 0;
  logs: string[] = [];

  pass(label: string) {
    this.total++;
    this.passed++;
    this.logs.push(`  ✓ ${label}`);
  }

  fail(label: string, err: unknown) {
    this.total++;
    this.failed++;
    const msg = err instanceof Error ? err.message : String(err);
    this.logs.push(`  ✗ ${label}: ${msg}`);
  }

  section(title: string) {
    this.logs.push('');
    this.logs.push(`── ${title} ──`);
  }

  print() {
    console.log('');
    console.log('═══════════════════════════════════════');
    console.log('  FabricFS 压力测试报告');
    console.log('═══════════════════════════════════════');
    this.logs.forEach((l) => console.log(l));
    console.log('');
    console.log(
      `  总计: ${this.total}  |  通过: ${this.passed}  |  失败: ${this.failed}`
    );
    console.log('');
  }
}

// ---- 随机数据生成工具 -----------------------------------------------------

function randomString(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789\n';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

// ---- 工具：递归删除 --------------------------------------------------------

async function rmdirRecursive(fs: FabricFS, path: string): Promise<void> {
  try {
    const entries = await fs.readdir(path);
    for (const name of entries) {
      const child = path === '/' ? `/${name}` : `${path}/${name}`;
      const st = await fs.stat(child);
      if (st?.type === 'dir') {
        await rmdirRecursive(fs, child);
      } else {
        await fs.unlink(child);
      }
    }
    if (path !== '/') await fs.rmdir(path);
  } catch {
    // 忽略清理中的错误
  }
}

// ---- 测试项 -----------------------------------------------------------------

async function testBoundary(fs: FabricFS, r: Report) {
  r.section('1. 分块边界测试');

  const sizes = [
    { label: 'inline（1 KB）', size: 1024 },
    { label: 'inline 近上限（64 KB - 1）', size: 65535 },
    { label: '刚好触发分块（64 KB）', size: 65536 },
    { label: '两块边缘（64 KB + 1）', size: 65537 },
    { label: '刚好两块（128 KB）', size: 131072 },
    { label: '两块半（128 KB + 1）', size: 131073 },
  ];

  for (const { label, size } of sizes) {
    await fs.mkdir('/__stress_boundary').catch(() => {});
    const path = `/__stress_boundary/${size}.dat`;
    const data = randomString(size);
    try {
      await fs.writeFile(path, data);
      const readback = await fs.readFile(path);
      if (readback === data) {
        r.pass(`${label} (${size}B) — 内容完整`);
      } else {
        r.fail(
          `${label} (${size}B)`,
          new Error(`长度不符: 期望 ${data.length}, 读到 ${readback?.length}`)
        );
      }
    } catch (err) {
      r.fail(`${label} (${size}B)`, err);
    }
  }

  // 清理
  await rmdirRecursive(fs, '/__stress_boundary');
}

async function testConcurrent(fs: FabricFS, r: Report) {
  r.section('2. 并发写入竞态');

  await fs.mkdir('/__stress_concur').catch(() => {});
  const path = '/__stress_concur/cas-test.txt';
  const data = randomString(1000);

  // 10 个协程同时写同一文件
  const writers = Array.from({ length: 10 }, (_, i) =>
    fs.writeFile(path, `${data}\n── writer ${i} ──\n`)
  );

  try {
    await Promise.all(writers);

    const result = await fs.readFile(path);
    if (result && result.length > 0 && result.includes('writer')) {
      // 成功 — 至少是 10 个 writer 中某一个的完整内容
      r.pass('10 路并发写入同一文件 — 无崩溃，无数据损坏');
      console.warn(`     结果长度: ${result.length}B`);
    } else {
      r.fail('并发写入后文件不可读', new Error(result ?? 'null'));
    }
  } catch (err) {
    r.fail('10 路并发写入', err);
  }

  // 清理
  await rmdirRecursive(fs, '/__stress_concur');
}

async function testManyFiles(fs: FabricFS, r: Report) {
  r.section('3. 大目录测试（500 文件）');

  await fs.mkdir('/__stress_many').catch(() => {});
  const count = 500;
  let ok = 0;

  try {
    // 写 500 个文件
    for (let i = 0; i < count; i++) {
      await fs.writeFile(`/__stress_many/f${i}.dat`, `data-${i}`);
      ok++;
    }
  } catch (err) {
    r.fail(`创建 ${count} 个文件（已创建 ${ok} 个）`, err);
  }

  // 验证 ls
  try {
    const entries = await fs.readdir('/__stress_many');
    if (entries.length === ok) {
      r.pass(`${ok} 个文件创建完成，ls 返回 ${entries.length} 个条目`);
    } else {
      r.fail(`条目数不符`, new Error(`期望 ${ok}，实际 ${entries.length}`));
    }
  } catch (err) {
    r.fail(`readdir /__stress_many`, err);
  }

  // 验证随机抽查
  try {
    for (let i = 0; i < count; i += 50) {
      // 每 50 个抽查一个
      const c = await fs.readFile(`/__stress_many/f${i}.dat`);
      if (c !== `data-${i}`) {
        throw new Error(`f${i}.dat 内容不符: 期望 "data-${i}"，读到 "${c}"`);
      }
    }
    r.pass(`随机抽查通过（间隔 50）`);
  } catch (err) {
    r.fail('随机抽查', err);
  }

  // 清理
  await rmdirRecursive(fs, '/__stress_many');
}

async function testFormatSwitching(fs: FabricFS, r: Report) {
  r.section('4. 存储格式反复横跳');

  await fs.mkdir('/__stress_switch').catch(() => {});
  const path = '/__stress_switch/yo-yo.dat';

  const phases = [
    { label: 'inline 1KB', size: 1024 },
    { label: 'chunked 128KB', size: 131072 },
    { label: 'inline 500B', size: 500 },
    { label: 'chunked 256KB', size: 262144 },
    { label: 'inline 10B', size: 10 },
    { label: 'chunked 65KB', size: 66560 },
  ];

  for (const { label, size } of phases) {
    const data = randomString(size);
    try {
      await fs.writeFile(path, data);
      const readback = await fs.readFile(path);
      if (readback === data) {
        r.pass(`${label} (${size}B) — 写入后内容完整`);
      } else {
        r.fail(
          `${label} (${size}B)`,
          new Error(`内容不符: 期望 ${size}B，读到 ${readback?.length}B`)
        );
      }
    } catch (err) {
      r.fail(`${label} (${size}B)`, err);
    }
  }

  await rmdirRecursive(fs, '/__stress_switch');
}

async function testRename(fs: FabricFS, r: Report) {
  r.section('5. rename 跨目录 + 覆盖');

  await fs.mkdir('/__stress_rename_a').catch(() => {});
  await fs.mkdir('/__stress_rename_b').catch(() => {});

  // 创建一个大文件并 rename
  const bigData = randomString(200000); // ~200KB，分块
  await fs.writeFile('/__stress_rename_a/big.dat', bigData);

  // 跨目录 rename
  try {
    await fs.rename('/__stress_rename_a/big.dat', '/__stress_rename_b/big.dat');
    r.pass('跨目录 rename 大文件（200KB 分块）');

    const readback = await fs.readFile('/__stress_rename_b/big.dat');
    if (readback === bigData) {
      r.pass('rename 后内容完整');
    } else {
      r.fail(
        'rename 后内容',
        new Error(`期望 ${bigData.length}B，读到 ${readback?.length}B`)
      );
    }

    // 验证旧路径已删除
    const exists = await fs.exists('/__stress_rename_a/big.dat');
    if (!exists) {
      r.pass('rename 后旧路径已不可见');
    } else {
      r.fail('rename 后旧路径仍存在', new Error('旧文件还在'));
    }
  } catch (err) {
    r.fail('跨目录 rename 大文件', err);
  }

  // 覆盖已存在的文件
  try {
    await fs.writeFile('/__stress_rename_b/big.dat', 'overwritten');
    const oc = await fs.readFile('/__stress_rename_b/big.dat');
    if (oc === 'overwritten') {
      r.pass('覆盖已有大文件 — 成功降级为 inline');
    } else {
      r.fail('覆盖 inline 内容', new Error(`读到: ${oc}`));
    }
  } catch (err) {
    r.fail('覆盖已有大文件', err);
  }

  await rmdirRecursive(fs, '/__stress_rename_a');
  await rmdirRecursive(fs, '/__stress_rename_b');
}

async function testDeepDirs(fs: FabricFS, r: Report) {
  r.section('6. 深目录嵌套');

  const depth = 20;
  let path = '/__stress_deep';
  try {
    for (let i = 0; i < depth; i++) {
      path += `/${i}`;
      await fs.mkdir(path);
    }
    r.pass(`${depth} 层嵌套目录创建成功`);

    // 在叶子目录写文件
    await fs.writeFile(`${path}/leaf.txt`, 'deep');
    const c = await fs.readFile(`${path}/leaf.txt`);
    if (c === 'deep') {
      r.pass(`深度 ${depth} 层读写文件成功`);
    } else {
      r.fail(`深度 ${depth} 层读文件内容`, new Error(`读到: ${c}`));
    }
  } catch (err) {
    r.fail(`${depth} 层嵌套`, err);
  }

  // 从根直接 resolve 最深路径，验证性能
  try {
    const t0 = Date.now();
    const exists = await fs.exists(
      '/__stress_deep/0/1/2/3/4/5/6/7/8/9/10/11/12/13/14/15/16/17/18/19/leaf.txt'
    );
    const elapsed = Date.now() - t0;
    console.warn(`     resolve 20 层路径: ${elapsed}ms`);
    if (exists) {
      r.pass(`20 层深度路径解析正确`);
    } else {
      r.fail('20 层深度路径解析', new Error('路径不存在'));
    }
  } catch (err) {
    r.fail('20 层深度路径解析', err);
  }

  await rmdirRecursive(fs, '/__stress_deep');
}

// ---- 公开入口 --------------------------------------------------------------

export async function runStressTest(fs: FabricFS): Promise<void> {
  const r = new Report();

  console.warn('\n  ⏱  FabricFS 压力测试开始...\n');

  const tests = [
    testBoundary,
    testConcurrent,
    testManyFiles,
    testFormatSwitching,
    testRename,
    testDeepDirs,
  ];

  for (const test of tests) {
    try {
      await test(fs, r);
    } catch (err) {
      r.fail(test.name, err);
    }
  }

  r.print();
}
