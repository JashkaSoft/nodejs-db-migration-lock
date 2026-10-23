import { SqlDriver } from '@nodejs-db-migration-lock/core';

type SqliteDatabase = any;
type SqliteStatement = {
  all: (...params: any[]) => unknown;
  run: (...params: any[]) => { changes?: number; lastInsertRowid?: number | bigint };
};

function returnsRows(sql: string): boolean {
  const normalized = sql.trim().replace(/^\(+/, '').toLowerCase();
  return /^(select|pragma|with|explain|values)\b/.test(normalized);
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
  constructor(private db: SqliteDatabase) {
    if (!db || typeof db.prepare !== 'function') {
      throw new Error('NodeSqliteDriver requires a node:sqlite DatabaseSync');
    }
    this.db.exec?.('PRAGMA busy_timeout = 5000');
    this.db.exec?.('PRAGMA journal_mode = WAL');
    this.db.exec?.('PRAGMA synchronous = NORMAL');
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const statement: SqliteStatement = this.db.prepare(sql);
    const bindings = params ?? [];
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

  async close(): Promise<void> {
    if (typeof this.db.close === 'function') {
      this.db.close();
    }
  }
}
