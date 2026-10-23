import {
  LockProvider,
  SqlDriver,
  normalizeAcquireOptions,
  scopedLockName,
} from '@nodejs-db-migration-lock/core';

export interface AdvisoryLockOptions {
  /** Explicit GET_LOCK name. When omitted, the name includes DATABASE(). */
  lockName?: string;
  /**
   * database: GET_LOCK(name, seconds) blocks in MySQL.
   * poll: GET_LOCK(name, 0) so the coordinator can retry.
   */
  wait?: 'database' | 'poll';
}

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
 * Session-scoped and server-wide: the name includes the database unless lockName is set.
 * The SqlDriver must keep one connection.
 */
export class MySQLAdvisoryLock implements LockProvider {
  name = 'mysql-advisory-lock';
  readonly waitsInDatabase: boolean;
  lockKey: string;
  private readonly explicitName?: string;
  private resolvedName?: string;

  constructor(options: AdvisoryLockOptions = {}) {
    this.waitsInDatabase = (options.wait ?? 'database') === 'database';
    this.explicitName = options.lockName;
    this.lockKey = options.lockName
      ? `mysql-advisory-lock:${options.lockName}`
      : 'mysql-advisory-lock:auto';
  }

  async acquire(driver: SqlDriver, options?: Parameters<LockProvider['acquire']>[1]): Promise<boolean> {
    const { signal, timeoutMs } = normalizeAcquireOptions(options);
    if (signal?.aborted) {
      return false;
    }

    const name = await this.resolveName(driver);
    const seconds =
      this.waitsInDatabase && timeoutMs !== undefined
        ? Math.max(0, Math.ceil(timeoutMs / 1000))
        : 0;
    const result = await driver.query<{ acquired: unknown }>(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [name, seconds],
    );
    return asLockResult(result[0]?.acquired);
  }

  async release(driver: SqlDriver): Promise<void> {
    const name = await this.resolveName(driver);
    await driver.query('SELECT RELEASE_LOCK(?) AS released', [name]);
  }

  async healthcheck(driver: SqlDriver): Promise<boolean> {
    try {
      await driver.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async resolveName(driver: SqlDriver): Promise<string> {
    if (this.explicitName) {
      return this.explicitName;
    }
    if (this.resolvedName) {
      return this.resolvedName;
    }
    const rows = await driver.query<{ name: string | null }>('SELECT DATABASE() AS name');
    const name = rows[0]?.name;
    if (!name) {
      throw new Error('DATABASE() returned no name; pass lockName');
    }
    this.resolvedName = scopedLockName(name);
    this.lockKey = `mysql-advisory-lock:${this.resolvedName}`;
    return this.resolvedName;
  }
}
