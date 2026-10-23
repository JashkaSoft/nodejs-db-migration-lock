import { SqlDriver } from '@nodejs-db-migration-lock/core';
import { MssqlAppLock } from '../../src/advisory-lock';

class MockDriver implements SqlDriver {
  public queries: Array<{ sql: string; params?: unknown[] }> = [];
  public acquired = 0;

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push({ sql, params });
    if (sql.includes('sp_getapplock')) {
      return [{ acquired: this.acquired }] as T[];
    }
    if (sql.includes('DB_NAME')) {
      return [{ name: 'appdb' }] as T[];
    }
    return [] as T[];
  }
}

describe('MssqlAppLock', () => {
  it('acquires when sp_getapplock returns 0 and passes the timeout', async () => {
    const driver = new MockDriver();
    const lock = new MssqlAppLock({ lockName: 'migration_lock' });

    await expect(lock.acquire(driver, { timeoutMs: 1500 })).resolves.toBe(true);
    expect(driver.queries[0].sql).toContain('sp_getapplock');
    expect(driver.queries[0].params).toEqual(['migration_lock', 'Session', 1500]);
  });

  it('does not acquire on a timeout code', async () => {
    const driver = new MockDriver();
    driver.acquired = -1;
    const lock = new MssqlAppLock({ lockName: 'migration_lock' });
    await expect(lock.acquire(driver)).resolves.toBe(false);
  });

  it('scopes the default resource with DB_NAME()', async () => {
    const driver = new MockDriver();
    const lock = new MssqlAppLock();
    await lock.acquire(driver);
    expect(driver.queries[0].sql).toContain('DB_NAME()');
    expect(driver.queries[1].params?.[0]).toBe('nodejs_db_migration_lock:appdb');
  });

  it('releases a session lock and skips release for a transaction lock', async () => {
    const driver = new MockDriver();
    const session = new MssqlAppLock({ lockName: 'migration_lock' });
    await session.release(driver);
    expect(driver.queries[0].sql).toContain('sp_releaseapplock');

    const transaction = new MssqlAppLock({ lockName: 'migration_lock', scope: 'transaction' });
    await transaction.release(driver);
    expect(driver.queries).toHaveLength(1);
    expect(transaction.transactionScoped).toBe(true);
  });

  it('returns false from healthcheck when the query fails', async () => {
    const driver = new MockDriver();
    driver.query = async () => {
      throw new Error('down');
    };
    const lock = new MssqlAppLock({ lockName: 'migration_lock' });
    await expect(lock.healthcheck(driver)).resolves.toBe(false);
  });
});
