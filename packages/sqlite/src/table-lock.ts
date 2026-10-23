import { LockProvider, SqlDriver } from '@nodejs-db-migration-lock/core';

export interface TableLockOptions {
  tableName?: string;
  lockId?: number;
}

const DEFAULT_OPTIONS = {
  tableName: 'migration_lock',
  lockId: 1,
};

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

function changedRows(row: { changes?: number; affectedRows?: number } | undefined): number {
  return row?.changes ?? row?.affectedRows ?? 0;
}

/**
 * Table-based lock using INSERT OR IGNORE on a single-row primary key.
 * SQLite has no session advisory locks; the database file serializes writers.
 */
export class SqliteTableLock implements LockProvider {
  name = 'sqlite-table-lock';
  private readonly tableName: string;
  private readonly lockId: number;

  constructor(options: TableLockOptions = {}) {
    this.tableName = options.tableName || DEFAULT_OPTIONS.tableName;
    this.lockId = options.lockId ?? DEFAULT_OPTIONS.lockId;
  }

  async ensureInfrastructure(driver: SqlDriver): Promise<void> {
    const table = quoteIdent(this.tableName);
    await driver.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id INTEGER NOT NULL PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }

  async acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }

    const table = quoteIdent(this.tableName);
    const result = await driver.query<{ changes?: number; affectedRows?: number }>(
      `INSERT OR IGNORE INTO ${table} (id) VALUES (?)`,
      [this.lockId],
    );
    return changedRows(result[0]) > 0;
  }

  async release(driver: SqlDriver): Promise<void> {
    const table = quoteIdent(this.tableName);
    await driver.query(`DELETE FROM ${table} WHERE id = ?`, [this.lockId]);
  }

  async healthcheck(driver: SqlDriver): Promise<boolean> {
    try {
      await driver.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
