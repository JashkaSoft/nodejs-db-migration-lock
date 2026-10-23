import {
  LockProvider,
  SqlDriver,
  normalizeAcquireOptions,
  scopedLockName,
} from '@nodejs-db-migration-lock/core';

export interface AppLockOptions {
  /** Explicit sp_getapplock resource. When omitted, the name includes DB_NAME(). */
  lockName?: string;
  /** Session is the default. Transaction requires SqlDriver.transaction around the migration. */
  scope?: 'session' | 'transaction';
  /**
   * database: sp_getapplock waits for timeoutMs.
   * poll: LockTimeout 0 so the coordinator can retry.
   */
  wait?: 'database' | 'poll';
}

/**
 * SQL Server application lock (sp_getapplock).
 * Exclusive, database-scoped, released when the session ends unless scope is transaction.
 * The SqlDriver must keep one connection.
 */
export class MssqlAppLock implements LockProvider {
  name = 'mssql-app-lock';
  readonly waitsInDatabase: boolean;
  readonly transactionScoped: boolean;
  lockKey: string;
  private readonly explicitName?: string;
  private resolvedName?: string;
  private readonly owner: 'Session' | 'Transaction';

  constructor(options: AppLockOptions = {}) {
    const scope = options.scope ?? 'session';
    this.owner = scope === 'transaction' ? 'Transaction' : 'Session';
    this.transactionScoped = scope === 'transaction';
    this.waitsInDatabase = (options.wait ?? 'database') === 'database';
    this.explicitName = options.lockName;
    this.lockKey = options.lockName
      ? `mssql-app-lock:${options.lockName}:${scope}`
      : `mssql-app-lock:auto:${scope}`;
  }

  async acquire(driver: SqlDriver, options?: Parameters<LockProvider['acquire']>[1]): Promise<boolean> {
    const { signal, timeoutMs } = normalizeAcquireOptions(options);
    if (signal?.aborted) {
      return false;
    }

    const name = await this.resolveName(driver);
    const timeout = this.waitsInDatabase && timeoutMs !== undefined ? timeoutMs : 0;
    const rows = await driver.query<{ acquired: number | null }>(
      `DECLARE @result int;
       EXEC @result = sp_getapplock
         @Resource = @p1,
         @LockMode = 'Exclusive',
         @LockOwner = @p2,
         @LockTimeout = @p3,
         @DbPrincipal = 'public';
       SELECT @result AS acquired;`,
      [name, this.owner, timeout],
    );
    const code = Number(rows[0]?.acquired);
    return Number.isFinite(code) && code >= 0;
  }

  async release(driver: SqlDriver): Promise<void> {
    if (this.transactionScoped) {
      return;
    }
    const name = await this.resolveName(driver);
    await driver.query(
      `DECLARE @result int;
       EXEC @result = sp_releaseapplock
         @Resource = @p1,
         @LockOwner = 'Session',
         @DbPrincipal = 'public';
       SELECT @result AS released;`,
      [name],
    );
  }

  async healthcheck(driver: SqlDriver): Promise<boolean> {
    try {
      await driver.query('SELECT 1 AS ok');
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
    const rows = await driver.query<{ name: string | null }>('SELECT DB_NAME() AS name');
    const name = rows[0]?.name;
    if (!name) {
      throw new Error('DB_NAME() returned no name; pass lockName');
    }
    this.resolvedName = scopedLockName(name, 'nodejs_db_migration_lock', 255);
    this.lockKey = `mssql-app-lock:${this.resolvedName}`;
    return this.resolvedName;
  }
}
