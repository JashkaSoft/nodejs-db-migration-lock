import { SqlDriver } from '@nodejs-db-migration-lock/core';
import { YugabyteTableLock } from '../../src/table-lock';

class MockDriver implements SqlDriver {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  rows: unknown[] = [{ id: '1' }];

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push({ sql, params });
    if (/^select 1$/i.test(sql.trim())) {
      return [{ ok: 1 }] as T[];
    }
    if (/^insert|^update|^select id/i.test(sql.trim())) {
      return this.rows as T[];
    }
    return [] as T[];
  }
}

describe('YugabyteTableLock', () => {
  it('creates the lease table without an advisory lock', async () => {
    const driver = new MockDriver();
    await new YugabyteTableLock().ensureInfrastructure(driver);
    const sql = driver.queries.map((query) => query.sql).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "migration_lock"');
    expect(sql).not.toContain('pg_advisory_lock');
  });

  it('acquires when the upsert returns a row', async () => {
    const driver = new MockDriver();
    const lock = new YugabyteTableLock({ leaseMs: 5000 });
    await expect(lock.acquire(driver)).resolves.toBe(true);
    expect(driver.queries[0].sql).toContain('ON CONFLICT');
    expect(driver.queries[0].params?.[0]).toBe(1);
  });

  it('does not acquire when the row is still leased', async () => {
    const driver = new MockDriver();
    driver.rows = [];
    await expect(new YugabyteTableLock().acquire(driver)).resolves.toBe(false);
  });

  it('releases only the matching holder and forceRelease deletes by id', async () => {
    const driver = new MockDriver();
    const lock = new YugabyteTableLock();
    await lock.release(driver);
    await lock.forceRelease(driver);
    expect(driver.queries[0].sql).toContain('holder');
    expect(driver.queries[1].sql).not.toContain('holder');
    expect(driver.queries[1].params).toEqual([1]);
  });
});
