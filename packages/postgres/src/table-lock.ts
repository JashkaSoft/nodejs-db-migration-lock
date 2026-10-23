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
  /** Session advisory lock used only while creating or altering the lock table. */
  advisoryLockId?: number;
  /** How long a holder keeps the row without renew(). Default 30s. */
  leaseMs?: number;
}

const DEFAULT_OPTIONS = {
  tableName: 'migration_lock',
  lockId: 1,
  advisoryLockId: 123456789,
  leaseMs: 30_000,
};

/**
 * One-row lease. A dead holder is replaced once expires_at is in the past.
 * release() deletes the row only when holder matches this instance.
 */
export class PostgresTableLock implements LockProvider {
  name = 'postgres-table-lock';
  readonly lockKey: string;
  readonly holder: string;
  private readonly tableName: string;
  private readonly lockId: number;
  private readonly advisoryLockId: number;
  private readonly leaseMs: number;

  constructor(options: TableLockOptions = {}) {
    this.tableName = options.tableName || DEFAULT_OPTIONS.tableName;
    this.lockId = options.lockId ?? DEFAULT_OPTIONS.lockId;
    this.advisoryLockId = options.advisoryLockId ?? DEFAULT_OPTIONS.advisoryLockId;
    this.leaseMs = options.leaseMs ?? DEFAULT_OPTIONS.leaseMs;
    this.holder = lockHolder();
    this.lockKey = `postgres-table-lock:${this.tableName}:${this.lockId}`;
  }

  async ensureInfrastructure(driver: SqlDriver): Promise<void> {
    const table = quoteIdent(this.tableName, '"');
    await driver.query('SELECT pg_advisory_lock($1::bigint)', [this.advisoryLockId]);

    try {
      const existing = await driver.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = current_schema() AND table_name = $1
         ) AS exists`,
        [this.tableName],
      );

      if (!existing[0]?.exists) {
        await driver.query(`
          CREATE TABLE ${table} (
            id INTEGER PRIMARY KEY,
            holder TEXT NOT NULL,
            locked_at BIGINT NOT NULL,
            expires_at BIGINT NOT NULL
          )
        `);
        return;
      }

      const columns = await driver.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = $1`,
        [this.tableName],
      );
      const names = new Set(columns.map((column) => column.column_name));
      if (!names.has('holder')) {
        await driver.query(`ALTER TABLE ${table} ADD COLUMN holder TEXT`);
        await driver.query(`ALTER TABLE ${table} ADD COLUMN locked_at BIGINT`);
        await driver.query(`ALTER TABLE ${table} ADD COLUMN expires_at BIGINT`);
        await driver.query(`UPDATE ${table} SET expires_at = 0 WHERE expires_at IS NULL`);
      }
    } finally {
      await driver.query('SELECT pg_advisory_unlock($1::bigint)', [this.advisoryLockId]);
    }
  }

  async acquire(driver: SqlDriver, options?: Parameters<LockProvider['acquire']>[1]): Promise<boolean> {
    const { signal } = normalizeAcquireOptions(options);
    if (signal?.aborted) {
      return false;
    }

    const now = Date.now();
    const table = quoteIdent(this.tableName, '"');
    const rows = await driver.query<{ id: number }>(
      `INSERT INTO ${table} (id, holder, locked_at, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
         SET holder = EXCLUDED.holder,
             locked_at = EXCLUDED.locked_at,
             expires_at = EXCLUDED.expires_at
         WHERE ${table}.expires_at < EXCLUDED.locked_at
       RETURNING id`,
      [this.lockId, this.holder, now, now + this.leaseMs],
    );
    return rows.length > 0;
  }

  async release(driver: SqlDriver): Promise<void> {
    const table = quoteIdent(this.tableName, '"');
    await driver.query(`DELETE FROM ${table} WHERE id = $1 AND holder = $2`, [
      this.lockId,
      this.holder,
    ]);
  }

  async renew(driver: SqlDriver): Promise<boolean> {
    const table = quoteIdent(this.tableName, '"');
    const expiresAt = Date.now() + this.leaseMs;
    const rows = await driver.query<{ id: number }>(
      `UPDATE ${table}
       SET expires_at = $3
       WHERE id = $1 AND holder = $2
       RETURNING id`,
      [this.lockId, this.holder, expiresAt],
    );
    return rows.length > 0;
  }

  async status(driver: SqlDriver): Promise<LockStatus | null> {
    const table = quoteIdent(this.tableName, '"');
    const rows = await driver.query<{
      id: number;
      holder: string | null;
      locked_at: number | null;
      expires_at: number | null;
    }>(
      `SELECT id, holder, locked_at, expires_at FROM ${table} WHERE id = $1`,
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
    await driver.query(`DELETE FROM ${table} WHERE id = $1`, [this.lockId]);
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
