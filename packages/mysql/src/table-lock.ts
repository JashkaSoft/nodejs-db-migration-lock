import {
  LockProvider,
  LockStatus,
  SqlDriver,
  lockHolder,
  normalizeAcquireOptions,
  quoteIdent,
  scopedLockName,
} from '@nodejs-db-migration-lock/core';

export interface TableLockOptions {
  tableName?: string;
  lockId?: number;
  /** GET_LOCK name held only around the row update. Server-wide, so it includes the database name when DATABASE() works. */
  ddlLockName?: string;
  leaseMs?: number;
}

const DEFAULT_OPTIONS = {
  tableName: 'migration_lock',
  lockId: 1,
  ddlLockName: 'migration_lock_ddl',
  leaseMs: 30_000,
};

function asLockResult(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') {
    return true;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.length > 0 && value[0] === 1;
  }
  return Number(value) === 1;
}

function affectedRows(row: { affectedRows?: number; affectedrows?: number } | undefined): number {
  return row?.affectedRows ?? row?.affectedrows ?? 0;
}

/**
 * One-row lease. GET_LOCK serializes the read-modify-write; the row records the holder.
 */
export class MySQLTableLock implements LockProvider {
  name = 'mysql-table-lock';
  readonly lockKey: string;
  readonly holder: string;
  private readonly tableName: string;
  private readonly lockId: number;
  private readonly ddlLockName: string;
  private readonly leaseMs: number;

  constructor(options: TableLockOptions = {}) {
    this.tableName = options.tableName || DEFAULT_OPTIONS.tableName;
    this.lockId = options.lockId ?? DEFAULT_OPTIONS.lockId;
    this.ddlLockName = options.ddlLockName || DEFAULT_OPTIONS.ddlLockName;
    this.leaseMs = options.leaseMs ?? DEFAULT_OPTIONS.leaseMs;
    this.holder = lockHolder();
    this.lockKey = `mysql-table-lock:${this.tableName}:${this.lockId}`;
  }

  async ensureInfrastructure(driver: SqlDriver): Promise<void> {
    await this.withMutex(driver, async () => {
      const table = quoteIdent(this.tableName, '`');
      await driver.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          id INT NOT NULL PRIMARY KEY,
          holder VARCHAR(255) NOT NULL,
          locked_at BIGINT NOT NULL,
          expires_at BIGINT NOT NULL
        )
      `);
    });
  }

  async acquire(driver: SqlDriver, options?: Parameters<LockProvider['acquire']>[1]): Promise<boolean> {
    const { signal } = normalizeAcquireOptions(options);
    if (signal?.aborted) {
      return false;
    }

    return this.withMutex(driver, async () => {
      const now = Date.now();
      const table = quoteIdent(this.tableName, '`');
      const rows = await driver.query<{ holder: string; expires_at: number | string }>(
        `SELECT holder, expires_at FROM ${table} WHERE id = ?`,
        [this.lockId],
      );
      const current = rows[0];
      if (current && Number(current.expires_at) >= now) {
        return false;
      }

      const expiresAt = now + this.leaseMs;
      if (current) {
        const updated = await driver.query<{ affectedRows?: number }>(
          `UPDATE ${table} SET holder = ?, locked_at = ?, expires_at = ? WHERE id = ? AND expires_at < ?`,
          [this.holder, now, expiresAt, this.lockId, now],
        );
        return affectedRows(updated[0]) > 0;
      }

      const inserted = await driver.query<{ affectedRows?: number }>(
        `INSERT INTO ${table} (id, holder, locked_at, expires_at) VALUES (?, ?, ?, ?)`,
        [this.lockId, this.holder, now, expiresAt],
      );
      return affectedRows(inserted[0]) > 0;
    });
  }

  async release(driver: SqlDriver): Promise<void> {
    await this.withMutex(driver, async () => {
      const table = quoteIdent(this.tableName, '`');
      await driver.query(`DELETE FROM ${table} WHERE id = ? AND holder = ?`, [
        this.lockId,
        this.holder,
      ]);
    });
  }

  async renew(driver: SqlDriver): Promise<boolean> {
    return this.withMutex(driver, async () => {
      const table = quoteIdent(this.tableName, '`');
      const updated = await driver.query<{ affectedRows?: number }>(
        `UPDATE ${table} SET expires_at = ? WHERE id = ? AND holder = ?`,
        [Date.now() + this.leaseMs, this.lockId, this.holder],
      );
      return affectedRows(updated[0]) > 0;
    });
  }

  async status(driver: SqlDriver): Promise<LockStatus | null> {
    const table = quoteIdent(this.tableName, '`');
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
    await this.withMutex(driver, async () => {
      const table = quoteIdent(this.tableName, '`');
      await driver.query(`DELETE FROM ${table} WHERE id = ?`, [this.lockId]);
    });
  }

  async healthcheck(driver: SqlDriver): Promise<boolean> {
    try {
      await driver.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async withMutex<T>(driver: SqlDriver, fn: () => Promise<T>): Promise<T> {
    const name = await this.mutexName(driver);
    const got = await driver.query<{ acquired: unknown }>(
      'SELECT GET_LOCK(?, 10) AS acquired',
      [name],
    );
    if (!asLockResult(got[0]?.acquired)) {
      throw new Error(`Failed to acquire MySQL lock mutex "${name}"`);
    }
    try {
      return await fn();
    } finally {
      await driver.query('SELECT RELEASE_LOCK(?) AS released', [name]);
    }
  }

  private async mutexName(driver: SqlDriver): Promise<string> {
    const rows = await driver.query<{ name: string | null }>('SELECT DATABASE() AS name');
    const databaseName = rows[0]?.name;
    if (!databaseName) {
      return this.ddlLockName;
    }
    return scopedLockName(databaseName, this.ddlLockName, 64);
  }
}
