import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

/**
 * Identity stored on a table-lock row.
 * Unique per provider instance so one process cannot release another instance's row.
 */
export function lockHolder(): string {
  const host = process.env.POD_NAME || process.env.HOSTNAME || hostname();
  return `${host}:${process.pid}:${randomUUID()}`;
}

export function quoteIdent(name: string, quote: '"' | '`' | '['): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  if (quote === '[') {
    return `[${name}]`;
  }
  return `${quote}${name}${quote}`;
}
