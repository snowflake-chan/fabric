/**
 * tokenizer — 命令解析
 */

export function tokenize(s: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === ' ' || s[i] === '\t') {
      i++;
      continue;
    }
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i];
      i++;
      let b = '';
      while (i < s.length && s[i] !== q) b += s[i++];
      i++;
      tokens.push(b);
      continue;
    }
    let b = '';
    while (i < s.length && s[i] !== ' ' && s[i] !== '\t') b += s[i++];
    tokens.push(b);
  }
  return tokens;
}

export function splitSemicolon(s: string): string[] {
  const parts: string[] = [];
  let cur = '',
    q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === ';') {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

export interface LogicalStep {
  cmd: string;
  require: 'success' | 'failure' | null;
}

export function parseLogical(s: string): LogicalStep[] {
  const result: LogicalStep[] = [];
  let cur = '',
    q: string | null = null,
    next: LogicalStep['require'] = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === '&' && s[i + 1] === '&') {
      result.push({ cmd: cur.trim(), require: next });
      cur = '';
      next = 'success';
      i++;
    } else if (c === '|' && s[i + 1] === '|') {
      result.push({ cmd: cur.trim(), require: next });
      cur = '';
      next = 'failure';
      i++;
    } else cur += c;
  }
  const last = cur.trim();
  if (last) result.push({ cmd: last, require: next });
  return result;
}

export function parsePipe(s: string): string[] {
  const parts: string[] = [];
  let cur = '',
    q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === '|' && s[i + 1] !== '|') {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts.filter((p) => p.trim().length > 0);
}
