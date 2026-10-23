import {
  LockProvider,
  SqlDriver,
  normalizeAcquireOptions,
  postgresAdvisoryKey,
} from '@nodejs-db-migration-lock/core';

export interface AdvisoryLockOptions {
  /** Explicit key. When omitted, the key is derived from current_database(). */
  lockId?: number | string;
  /** Session locks survive the statements of a migration. Transaction locks end at COMMIT. */
  scope?: 'session' | 'transaction';
  /**
   * database: block in Postgres until timeoutMs.
   * poll: pg_try_advisory_lock so the coordinator can retry.
   */
  wait?: 'database' | 'poll';
}

function lockParam(key: string): string | number {
  if (/^\d+$/.test(key)) {
    const value = Number(key);
    if (Number.isSafeInteger(value)) {
      return value;
    }
  }
  return key;
}

function isLockTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  if ((error as { code?: string }).code === '55P03') {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return /lock timeout|canceling statement due to lock timeout/i.test(message);
}

/**
 * PostgreSQL advisory lock.
 * Session scope is the default: it is held until unlock or disconnect, including
 * across the transactions a migration runner opens.
 */
export class PostgresAdvisoryLock implements LockProvider {
  name = 'postgres-advisory-lock';
  readonly waitsInDatabase: boolean;
  readonly transactionScoped: boolean;
  lockKey: string;
  private readonly explicitKey?: string;
  private resolvedKey?: string;

  constructor(options: AdvisoryLockOptions = {}) {
    const scope = options.scope ?? 'session';
    this.waitsInDatabase = (options.wait ?? 'database') === 'database';
    this.transactionScoped = scope === 'transaction';
    if (options.lockId !== undefined) {
      this.explicitKey = String(options.lockId);
    }
    this.lockKey = this.explicitKey
      ? `postgres-advisory-lock:${this.explicitKey}:${scope}`
      : `postgres-advisory-lock:auto:${scope}`;
  }

  async acquire(driver: SqlDriver, options?: Parameters<LockProvider['acquire']>[1]): Promise<boolean> {
    const { signal, timeoutMs } = normalizeAcquireOptions(options);
    if (signal?.aborted) {
      return false;
    }

    const key = lockParam(await this.resolveKey(driver));
    if (this.transactionScoped) {
      return this.acquireTransaction(driver, key, timeoutMs);
    }
    return this.acquireSession(driver, key, timeoutMs);
  }

  async release(driver: SqlDriver): Promise<void> {
    if (this.transactionScoped) {
      return;
    }
    const key = lockParam(await this.resolveKey(driver));
    await driver.query('SELECT pg_advisory_unlock($1::bigint)', [key]);
  }

  async healthcheck(driver: SqlDriver): Promise<boolean> {
    try {
      await driver.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async resolveKey(driver: SqlDriver): Promise<string> {
    if (this.explicitKey) {
      return this.explicitKey;
    }
    if (this.resolvedKey) {
      return this.resolvedKey;
    }
    const rows = await driver.query<{ name: string | null }>('SELECT current_database() AS name');
    const name = rows[0]?.name;
    if (!name) {
      throw new Error('current_database() returned no name; pass lockId');
    }
    this.resolvedKey = postgresAdvisoryKey(name);
    this.lockKey = `postgres-advisory-lock:${this.resolvedKey}`;
    return this.resolvedKey;
  }

  private async acquireSession(
    driver: SqlDriver,
    key: string | number,
    timeoutMs: number | undefined,
  ): Promise<boolean> {
    if (!this.waitsInDatabase || timeoutMs === undefined) {
      const rows = await driver.query<{ pg_try_advisory_lock: boolean | null }>(
        'SELECT pg_try_advisory_lock($1::bigint) AS pg_try_advisory_lock',
        [key],
      );
      return rows[0]?.pg_try_advisory_lock === true;
    }

    const take = async () => {
      await driver.query('SELECT set_config($1, $2, true)', ['lock_timeout', String(timeoutMs)]);
      await driver.query('SELECT pg_advisory_lock($1::bigint)', [key]);
    };

    try {
      if (driver.transaction) {
        await driver.transaction(take);
      } else {
        await take();
      }
      return true;
    } catch (error) {
      if (isLockTimeout(error)) {
        return false;
      }
      throw error;
    }
  }

  private async acquireTransaction(
    driver: SqlDriver,
    key: string | number,
    timeoutMs: number | undefined,
  ): Promise<boolean> {
    try {
      if (this.waitsInDatabase && timeoutMs !== undefined) {
        await driver.query('SELECT set_config($1, $2, true)', ['lock_timeout', String(timeoutMs)]);
        await driver.query('SELECT pg_advisory_xact_lock($1::bigint)', [key]);
        return true;
      }
      const rows = await driver.query<{ acquired: boolean | null }>(
        'SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired',
        [key],
      );
      return rows[0]?.acquired === true;
    } catch (error) {
      if (isLockTimeout(error)) {
        return false;
      }
      throw error;
    }
  }
}
