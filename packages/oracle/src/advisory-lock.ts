import {
  LockProvider,
  SqlDriver,
  crc32,
  normalizeAcquireOptions,
} from '@nodejs-db-migration-lock/core';

export interface AppLockOptions {
  /** Explicit DBMS_LOCK id in 1..1073741823. When omitted, derived from the database name. */
  lockId?: number;
  /** Session is the default. Transaction releases the lock at COMMIT or ROLLBACK. */
  scope?: 'session' | 'transaction';
  /**
   * database: DBMS_LOCK.REQUEST waits for timeoutMs.
   * poll: timeout 0 so the coordinator can retry.
   */
  wait?: 'database' | 'poll';
}

const OUT = { out: true };

/**
 * Oracle DBMS_LOCK exclusive lock.
 * The id must stay in 0..1073741823. The driver keeps one session.
 */
export class OracleAppLock implements LockProvider {
  name = 'oracle-dbms-lock';
  readonly waitsInDatabase: boolean;
  readonly transactionScoped: boolean;
  lockKey: string;
  private readonly explicitId?: number;
  private resolvedId?: number;

  constructor(options: AppLockOptions = {}) {
    const scope = options.scope ?? 'session';
    this.transactionScoped = scope === 'transaction';
    this.waitsInDatabase = (options.wait ?? 'database') === 'database';
    this.explicitId = options.lockId;
    if (options.lockId !== undefined && (options.lockId < 0 || options.lockId > 1_073_741_823)) {
      throw new Error('Oracle DBMS_LOCK id must be between 0 and 1073741823');
    }
    this.lockKey = options.lockId !== undefined
      ? `oracle-dbms-lock:${options.lockId}:${scope}`
      : `oracle-dbms-lock:auto:${scope}`;
  }

  async acquire(driver: SqlDriver, options?: Parameters<LockProvider['acquire']>[1]): Promise<boolean> {
    const { signal, timeoutMs } = normalizeAcquireOptions(options);
    if (signal?.aborted) {
      return false;
    }
    const id = await this.resolveId(driver);
    const seconds = this.waitsInDatabase && timeoutMs !== undefined ? Math.ceil(timeoutMs / 1000) : 0;
    const releaseOnCommit = this.transactionScoped ? 'TRUE' : 'FALSE';
    const rows = await driver.query<{ acquired: number }>(
      `DECLARE
         l_id NUMBER := :id;
         l_timeout NUMBER := :timeout;
       BEGIN
         :acquired := DBMS_LOCK.REQUEST(
           id => l_id,
           lockmode => DBMS_LOCK.X_MODE,
           timeout => l_timeout,
           release_on_commit => ${releaseOnCommit}
         );
       END;`,
      [id, seconds, OUT],
    );
    const code = Number(rows[0]?.acquired);
    if (code === 2) {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' });
    }
    return code === 0 || code === 4;
  }

  async release(driver: SqlDriver): Promise<void> {
    if (this.transactionScoped) {
      return;
    }
    const id = await this.resolveId(driver);
    await driver.query(
      `DECLARE
         l_id NUMBER := :id;
       BEGIN
         :released := DBMS_LOCK.RELEASE(id => l_id);
       END;`,
      [id, OUT],
    );
  }

  async healthcheck(driver: SqlDriver): Promise<boolean> {
    try {
      await driver.query('SELECT 1 AS ok FROM DUAL');
      return true;
    } catch {
      return false;
    }
  }

  private async resolveId(driver: SqlDriver): Promise<number> {
    if (this.explicitId !== undefined) {
      return this.explicitId;
    }
    if (this.resolvedId !== undefined) {
      return this.resolvedId;
    }
    const rows = await driver.query<Record<string, unknown>>('SELECT SYS_CONTEXT(\'USERENV\', \'DB_NAME\') AS name FROM DUAL');
    const row = rows[0];
    const raw = row?.name ?? row?.NAME;
    const name = typeof raw === 'string' ? raw : undefined;
    if (!name) {
      throw new Error('DB_NAME is empty; pass lockId');
    }
    const id = crc32(name) & 0x3fffffff;
    this.resolvedId = id === 0 ? 1 : id;
    this.lockKey = `oracle-dbms-lock:${this.resolvedId}`;
    return this.resolvedId;
  }
}
