import { SqlDriver } from '@nodejs-db-migration-lock/core';
import { OracleAppLock } from '../../src/advisory-lock';

class MockDriver implements SqlDriver {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  acquired = 0;

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push({ sql, params });
    if (sql.includes('SYS_CONTEXT')) {
      return [{ name: 'FREEPDB1' }] as T[];
    }
    if (sql.includes('DBMS_LOCK.REQUEST')) {
      return [{ acquired: this.acquired }] as T[];
    }
    return [] as T[];
  }
}

describe('OracleAppLock', () => {
  it('requests an exclusive lock and treats 0 as acquired', async () => {
    const driver = new MockDriver();
    const lock = new OracleAppLock({ lockId: 42 });
    await expect(lock.acquire(driver, { timeoutMs: 1500 })).resolves.toBe(true);
    expect(driver.queries[0].sql).toContain('DBMS_LOCK.REQUEST');
    expect(driver.queries[0].sql).toContain('release_on_commit => FALSE');
    expect(driver.queries[0].params?.[0]).toBe(42);
    expect(driver.queries[0].params?.[1]).toBe(2);
  });

  it('returns false on timeout and throws on deadlock', async () => {
    const driver = new MockDriver();
    driver.acquired = 1;
    const lock = new OracleAppLock({ lockId: 7, wait: 'poll' });
    await expect(lock.acquire(driver)).resolves.toBe(false);
    driver.acquired = 2;
    await expect(lock.acquire(driver)).rejects.toThrow(/deadlock/);
  });

  it('derives a DBMS_LOCK id from the database name', async () => {
    const driver = new MockDriver();
    const lock = new OracleAppLock();
    await lock.acquire(driver, { timeoutMs: 0 });
    const id = driver.queries.at(-1)?.params?.[0];
    expect(typeof id).toBe('number');
    expect(id as number).toBeGreaterThan(0);
    expect(id as number).toBeLessThanOrEqual(1073741823);
    expect(driver.queries[0].sql).toContain('SYS_CONTEXT');
  });

  it('skips release for a transaction lock', async () => {
    const driver = new MockDriver();
    const lock = new OracleAppLock({ lockId: 9, scope: 'transaction' });
    await lock.acquire(driver);
    await lock.release(driver);
    expect(driver.queries.some((query) => query.sql.includes('RELEASE'))).toBe(false);
    expect(driver.queries[0].sql).toContain('release_on_commit => TRUE');
  });

  it('rejects an id outside the DBMS_LOCK range', () => {
    expect(() => new OracleAppLock({ lockId: 2_000_000_000 })).toThrow(/1073741823/);
  });
});
