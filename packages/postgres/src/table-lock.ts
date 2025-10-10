import { LockProvider, SqlDriver } from '@nodejs-db-migration-lock/core';

export interface TableLockOptions {
  tableName?: string;
  lockId?: number;
  advisoryLockId?: number;
}

const DEFAULT_OPTIONS: Required<TableLockOptions> = {
  tableName: 'migration_lock',
  lockId: 1,
  advisoryLockId: 123456789,
};

/**
 * PostgreSQL table-based lock implementation
 * Uses a dedicated table with a fixed ID to ensure only one lock exists
 */
export class PostgresTableLock implements LockProvider {
  name = 'postgres-table-lock';
  private readonly tableName: string;
  private readonly lockId: number;
  private readonly advisoryLockId: number;

  constructor(options: TableLockOptions = {}) {
    this.tableName = options.tableName || DEFAULT_OPTIONS.tableName;
    this.lockId = options.lockId ?? DEFAULT_OPTIONS.lockId;
    this.advisoryLockId = options.advisoryLockId ?? DEFAULT_OPTIONS.advisoryLockId;
  }

  async ensureInfrastructure(driver: SqlDriver): Promise<void> {
    // Use advisory lock to prevent race condition when creating table
    await driver.query(`SELECT pg_advisory_lock($1)`, [this.advisoryLockId]);

    try {
      // Check if table already exists
      const result = await driver.query<{ exists: boolean }>(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = $1
        ) as exists;
      `, [this.tableName]);

      if (result[0]?.exists) {
        return; // Table already exists, nothing to do
      }

      // Create sequence separately to avoid race condition
      await driver.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = '${this.tableName}_id_seq') THEN
            CREATE SEQUENCE ${this.tableName}_id_seq;
          END IF;
        END $$;
      `);

      // Create table using the sequence
      await driver.query(`
        CREATE TABLE IF NOT EXISTS ${this.tableName} (
          id INTEGER PRIMARY KEY DEFAULT nextval('${this.tableName}_id_seq'),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
    } finally {
      // Always release advisory lock
      await driver.query(`SELECT pg_advisory_unlock($1)`, [this.advisoryLockId]);
    }
  }

  async acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }

    const result = await driver.query<{ id: number }>(`
      INSERT INTO ${this.tableName} (id) 
      VALUES ($1) 
      ON CONFLICT (id) DO NOTHING 
      RETURNING id;
    `, [this.lockId]);

    return result.length > 0;
  }

  async release(driver: SqlDriver): Promise<void> {
    await driver.query(`DELETE FROM ${this.tableName} WHERE id = $1;`, [this.lockId]);
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

