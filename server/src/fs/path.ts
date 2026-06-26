/**
 * Path — 路径工具
 *
 * 纯字符串处理，无 I/O。
 * 所有路径要求以 / 开头（绝对路径）。
 */

export class Path {
  /** "/a/b/c" → ["a", "b", "c"]，"/" → [] */
  static split(p: string): string[] {
    if (!p.startsWith('/')) throw new Error(`Path must be absolute: ${p}`);
    return p.split('/').filter(Boolean);
  }

  /** "/a/b/c" → "/a/b"，"/a" → "/"，"/" → "/" */
  static parent(p: string): string {
    const parts = this.split(p);
    if (parts.length <= 1) return '/';
    return `/${parts.slice(0, -1).join('/')}`;
  }

  /** "/a/b/c" → "c" */
  static basename(p: string): string {
    const parts = this.split(p);
    return parts[parts.length - 1] ?? '';
  }

  /** 将 relative 路径基于 cwd 解析为标准绝对路径，处理 . 和 .. */
  static resolve(cwd: string, relative: string): string {
    const target = relative.startsWith('/') ? relative : `${cwd}/${relative}`;
    const parts = target.split('/').filter(Boolean);
    const result: string[] = [];
    for (const p of parts) {
      if (p === '.') continue;
      if (p === '..') {
        result.pop();
        continue;
      }
      result.push(p);
    }
    return `/${result.join('/')}`;
  }

  /** 判断路径是否等于或子路径 */
  static isChildOrSelf(parent: string, child: string): boolean {
    return child === parent || child.startsWith(`${parent}/`);
  }
}
