import { LockProvider, SqlDriver } from '@nodejs-db-migration-lock/core';

export interface TableLockOptions {
  tableName?: string;
  lockId?: number;
  ddlLockName?: string;
}

const DEFAULT_OPTIONS = {
  tableName: 'migration_lock',
  lockId: 1,
  ddlLockName: 'migration_lock_ddl',
};

function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `\`${name}\``;
}

function affectedRows(row: { affectedRows?: number } | undefined): number {
  return row?.affectedRows ?? 0;
}

/**
 * Table-based lock using INSERT IGNORE on a single-row primary key.
 */
export class MySQLTableLock implements LockProvider {
  name = 'mysql-table-lock';
  private readonly tableName: string;
  private readonly lockId: number;
  private readonly ddlLockName: string;

  constructor(options: TableLockOptions = {}) {
    this.tableName = options.tableName || DEFAULT_OPTIONS.tableName;
    this.lockId = options.lockId ?? DEFAULT_OPTIONS.lockId;
    this.ddlLockName = options.ddlLockName || DEFAULT_OPTIONS.ddlLockName;
  }

  async ensureInfrastructure(driver: SqlDriver): Promise<void> {
    await driver.query('SELECT GET_LOCK(?, 10) AS acquired', [this.ddlLockName]);
    try {
      const table = quoteIdent(this.tableName);
      await driver.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id INT NOT NULL PRIMARY KEY,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } finally {
      await driver.query('SELECT RELEASE_LOCK(?) AS released', [this.ddlLockName]);
    }
  }

  async acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }

    const table = quoteIdent(this.tableName);
    const result = await driver.query<{ affectedRows: number }>(
      `INSERT IGNORE INTO ${table} (id) VALUES (?)`,
      [this.lockId],
    );
    return affectedRows(result[0]) > 0;
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
