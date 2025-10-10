import { LockProvider, SqlDriver } from '@nodejs-db-migration-lock/core';

export interface AdvisoryLockOptions {
  lockId?: number;
}

const DEFAULT_LOCK_ID = 123456789;

/**
 * PostgreSQL advisory lock implementation
 * Uses session-level advisory locks for fast, lightweight locking
 */
export class PostgresAdvisoryLock implements LockProvider {
  name = 'postgres-advisory-lock';
  private readonly lockId: number;

  constructor(options: AdvisoryLockOptions = {}) {
    this.lockId = options.lockId ?? DEFAULT_LOCK_ID;
  }

  async acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }

    const result = await driver.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1) as pg_try_advisory_lock',
      [this.lockId],
    );
    return result[0]?.pg_try_advisory_lock === true;
  }

  async release(driver: SqlDriver): Promise<void> {
    await driver.query('SELECT pg_advisory_unlock($1)', [this.lockId]);
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
