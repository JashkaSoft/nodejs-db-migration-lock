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
  /** How long a holder keeps the row without renew(). Default 30s. */
  leaseMs?: number;
}

const DEFAULT_OPTIONS = {
  tableName: 'migration_lock',
  lockId: 1,
  leaseMs: 30_000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDuplicateRelationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: string }).code;
  if (code === '42P07' || code === '42710') {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /already exists/i.test(message);
}

/**
 * One-row lease. Session advisory locks are not used on YugabyteDB.
 * Concurrent migrators check information_schema before CREATE and tolerate duplicate DDL races.
 */
export class YugabyteTableLock implements LockProvider {
  name = 'yugabyte-table-lock';
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
    this.lockKey = `yugabyte-table-lock:${this.tableName}:${this.lockId}`;
  }

  async ensureInfrastructure(driver: SqlDriver): Promise<void> {
    const table = quoteIdent(this.tableName, '"');
    const createSql = `
      CREATE TABLE ${table} (
        id BIGINT PRIMARY KEY,
        holder TEXT NOT NULL,
        locked_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      )
    `;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await driver.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = current_schema() AND table_name = $1
         ) AS exists`,
        [this.tableName],
      );
      if (existing[0]?.exists) {
        break;
      }
      try {
        await driver.query(createSql);
      } catch (error) {
        if (!isDuplicateRelationError(error)) {
          throw error;
        }
      }
      await sleep(50 * (attempt + 1));
    }

    await driver.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGINT PRIMARY KEY,
        holder TEXT NOT NULL,
        locked_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL
      )
    `);

    await driver.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS holder TEXT`);
    await driver.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS locked_at BIGINT`);
    await driver.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS expires_at BIGINT`);
  }

  async acquire(driver: SqlDriver, options?: Parameters<LockProvider['acquire']>[1]): Promise<boolean> {
    const { signal } = normalizeAcquireOptions(options);
    if (signal?.aborted) {
      return false;
    }
    const now = Date.now();
    const table = quoteIdent(this.tableName, '"');
    const rows = await driver.query<{ id: string }>(
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
    const rows = await driver.query<{ id: string }>(
      `UPDATE ${table} SET expires_at = $3 WHERE id = $1 AND holder = $2 RETURNING id`,
      [this.lockId, this.holder, Date.now() + this.leaseMs],
    );
    return rows.length > 0;
  }

  async status(driver: SqlDriver): Promise<LockStatus | null> {
    const table = quoteIdent(this.tableName, '"');
    const rows = await driver.query<{
      id: string;
      holder: string | null;
      locked_at: string | null;
      expires_at: string | null;
    }>(`SELECT id, holder, locked_at, expires_at FROM ${table} WHERE id = $1`, [this.lockId]);
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
