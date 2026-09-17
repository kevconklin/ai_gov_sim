/**
 * Translate `?` placeholders to Postgres `$n` placeholders.
 * Skips `?` inside single-quoted strings, double-quoted identifiers,
 * line comments (-- ...) and block comments.
 */
export function toPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === "'" || ch === '"') {
      const end = findQuoteEnd(sql, i, ch);
      out += sql.slice(i, end);
      i = end;
    } else if (ch === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      out += sql.slice(i, end);
      i = end;
    } else if (ch === "/" && next === "*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? sql.length : close + 2;
      out += sql.slice(i, end);
      i = end;
    } else if (ch === "?") {
      n += 1;
      out += `$${n}`;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** Index just past the closing quote; doubled quotes ('') are escapes. */
function findQuoteEnd(sql: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i += 1;
  }
  return sql.length;
}

export function countPlaceholders(sql: string): number {
  const translated = toPgPlaceholders(sql);
  const matches = translated.match(/\$\d+/g);
  return matches ? matches.length : 0;
}
