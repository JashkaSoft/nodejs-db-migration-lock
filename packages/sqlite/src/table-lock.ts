import {
  LockProvider,
  LockStatus,
  SqlDriver,
  lockHolder,
  normalizeAcquireOptions,
  quoteIdent,
} from '@nodejs-db-migration-lock/core';

export interface TableLockOptions {
  tableName?: string;
  lockId?: number;
  leaseMs?: number;
}

const DEFAULT_OPTIONS = {
  tableName: 'migration_lock',
  lockId: 1,
  leaseMs: 30_000,
};

function changedRows(row: { changes?: number; affectedRows?: number } | undefined): number {
  return row?.changes ?? row?.affectedRows ?? 0;
}

/**
 * One-row lease. SQLite's writer lock makes the upsert atomic inside a transaction.
 */
export class SqliteTableLock implements LockProvider {
  name = 'sqlite-table-lock';
  readonly lockKey: string;
  readonly holder: string;
  private readonly tableName: string;
  private readonly lockId: number;
  private readonly leaseMs: number;

  constructor(options: TableLockOptions = {}) {
    this.tableName = options.tableName || DEFAULT_OPTIONS.tableName;
    this.lockId = options.lockId ?? DEFAULT_OPTIONS.lockId;
    this.leaseMs = options.leaseMs ?? DEFAULT_OPTIONS.leaseMs;
    this.holder = lockHolder();
    this.lockKey = `sqlite-table-lock:${this.tableName}:${this.lockId}`;
  }

  async ensureInfrastructure(driver: SqlDriver): Promise<void> {
    const table = quoteIdent(this.tableName, '"');
    await driver.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id INTEGER NOT NULL PRIMARY KEY,
        holder TEXT NOT NULL,
        locked_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
  }

  async acquire(driver: SqlDriver, options?: Parameters<LockProvider['acquire']>[1]): Promise<boolean> {
    const { signal } = normalizeAcquireOptions(options);
    if (signal?.aborted) {
      return false;
    }

    const write = async () => {
      const now = Date.now();
      const table = quoteIdent(this.tableName, '"');
      const result = await driver.query<{ changes?: number; affectedRows?: number }>(
        `INSERT INTO ${table} (id, holder, locked_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE
           SET holder = excluded.holder,
               locked_at = excluded.locked_at,
               expires_at = excluded.expires_at
           WHERE ${table}.expires_at < excluded.locked_at`,
        [this.lockId, this.holder, now, now + this.leaseMs],
      );
      return changedRows(result[0]) > 0;
    };

    if (driver.transaction) {
      return driver.transaction(write);
    }
    return write();
  }

  async release(driver: SqlDriver): Promise<void> {
    const table = quoteIdent(this.tableName, '"');
    await driver.query(`DELETE FROM ${table} WHERE id = ? AND holder = ?`, [
      this.lockId,
      this.holder,
    ]);
  }

  async renew(driver: SqlDriver): Promise<boolean> {
    const table = quoteIdent(this.tableName, '"');
    const result = await driver.query<{ changes?: number; affectedRows?: number }>(
      `UPDATE ${table} SET expires_at = ? WHERE id = ? AND holder = ?`,
      [Date.now() + this.leaseMs, this.lockId, this.holder],
    );
    return changedRows(result[0]) > 0;
  }

  async status(driver: SqlDriver): Promise<LockStatus | null> {
    const table = quoteIdent(this.tableName, '"');
    const rows = await driver.query<{
      id: number;
      holder: string | null;
      locked_at: number | null;
      expires_at: number | null;
    }>(
      `SELECT id, holder, locked_at, expires_at FROM ${table} WHERE id = ?`,
      [this.lockId],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      lockId: String(row.id),
      holder: row.holder,
      lockedAt: row.locked_at === null ? null : Number(row.locked_at),
      expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    };
  }

  async forceRelease(driver: SqlDriver): Promise<void> {
    const table = quoteIdent(this.tableName, '"');
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
