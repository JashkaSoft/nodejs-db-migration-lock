import { SqlDriver } from '@nodejs-db-migration-lock/core';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

function returnsRows(sql: string): boolean {
  const normalized = sql.trim().replace(/^\(+/, '').toLowerCase();
  return /^(select|pragma|with|explain|values)\b/.test(normalized);
}

function isBufferView(value: unknown): value is NodeJS.ArrayBufferView {
  return ArrayBuffer.isView(value);
}

function toSqliteValue(value: unknown): SQLInputValue {
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'string' ||
    isBufferView(value)
  ) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  throw new TypeError('Unsupported SQLite parameter');
}

function unwrapRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === 'object') {
    return [result as T];
  }
  return [];
}

/**
 * Adapter for Node.js `node:sqlite` DatabaseSync.
 * Enables WAL and a busy timeout so concurrent processes can share one file.
 */
export class NodeSqliteDriver implements SqlDriver {
  constructor(private db: DatabaseSync) {
    if (!db || typeof db.prepare !== 'function') {
      throw new Error('NodeSqliteDriver requires a node:sqlite DatabaseSync');
    }
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const statement = this.db.prepare(sql);
    const bindings = (params ?? []).map(toSqliteValue);
    if (returnsRows(sql)) {
      return unwrapRows<T>(statement.all(...bindings));
    }
    const result = statement.run(...bindings);
    return [
      {
        changes: Number(result?.changes ?? 0),
        affectedRows: Number(result?.changes ?? 0),
        lastInsertRowid: result?.lastInsertRowid,
      } as T,
    ];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // ignore rollback errors after a failed BEGIN
      }
      throw error;
    }
  }

  async fork(): Promise<SqlDriver> {
    const path = this.db.location();
    if (!path) {
      throw new Error('NodeSqliteDriver.fork requires a file-backed database');
    }
    return new NodeSqliteDriver(new DatabaseSync(path));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
