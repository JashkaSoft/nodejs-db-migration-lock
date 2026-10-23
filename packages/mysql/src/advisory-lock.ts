import { LockProvider, SqlDriver } from '@nodejs-db-migration-lock/core';

export interface AdvisoryLockOptions {
  lockName?: string;
}

const DEFAULT_LOCK_NAME = 'nodejs_db_migration_lock';

function asLockResult(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') {
    return true;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.length > 0 && value[0] === 1;
  }
  return Number(value) === 1;
}

/**
 * MySQL named lock using GET_LOCK() / RELEASE_LOCK().
 * Session-scoped: the SqlDriver must keep one connection.
 */
export class MySQLAdvisoryLock implements LockProvider {
  name = 'mysql-advisory-lock';
  private readonly lockName: string;

  constructor(options: AdvisoryLockOptions = {}) {
    this.lockName = options.lockName || DEFAULT_LOCK_NAME;
  }

  async acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }

    const result = await driver.query<{ acquired: unknown }>(
      'SELECT GET_LOCK(?, 0) AS acquired',
      [this.lockName],
    );
    return asLockResult(result[0]?.acquired);
  }

  async release(driver: SqlDriver): Promise<void> {
    await driver.query('SELECT RELEASE_LOCK(?) AS released', [this.lockName]);
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
