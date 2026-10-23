import { SqliteTableLock } from '../../src/table-lock';
import { SqlDriver } from '@nodejs-db-migration-lock/core';

class MockSqliteDriver implements SqlDriver {
  public queries: Array<{ sql: string; params?: unknown[] }> = [];
  public insertChanges = 1;
  public shouldFail = false;

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push({ sql, params });
    if (this.shouldFail) {
      throw new Error('Query failed');
    }
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('insert') || normalized.includes('update')) {
      return [{ changes: this.insertChanges, affectedRows: this.insertChanges }] as T[];
    }
    if (normalized.includes('select 1')) {
      return [{ '1': 1 }] as T[];
    }
    return [] as T[];
  }
}

describe('SqliteTableLock', () => {
  it('creates the lock table', async () => {
    const driver = new MockSqliteDriver();
    const lock = new SqliteTableLock({ tableName: 'migration_lock' });
    await lock.ensureInfrastructure(driver);
    expect(driver.queries[0].sql).toContain('CREATE TABLE IF NOT EXISTS "migration_lock"');
  });

  it('acquires when insert changes a row', async () => {
    const driver = new MockSqliteDriver();
    const lock = new SqliteTableLock();
    await expect(lock.acquire(driver)).resolves.toBe(true);
  });

  it('does not acquire when insert is ignored', async () => {
    const driver = new MockSqliteDriver();
    driver.insertChanges = 0;
    const lock = new SqliteTableLock();
    await expect(lock.acquire(driver)).resolves.toBe(false);
  });

  it('releases the lock row', async () => {
    const driver = new MockSqliteDriver();
    const lock = new SqliteTableLock();
    await lock.release(driver);
    expect(driver.queries[0].sql).toContain('DELETE FROM "migration_lock"');
    expect(driver.queries[0].params?.[0]).toBe(1);
    expect(driver.queries[0].params?.[1]).toBe(lock.holder);
  });

  it('rejects unsafe table names', async () => {
    const driver = new MockSqliteDriver();
    const lock = new SqliteTableLock({ tableName: 'lock;drop' });
    await expect(lock.ensureInfrastructure(driver)).rejects.toThrow(
      'Invalid SQL identifier',
    );
  });

  it('healthcheck returns false on query failure', async () => {
    const driver = new MockSqliteDriver();
    driver.shouldFail = true;
    const lock = new SqliteTableLock();
    await expect(lock.healthcheck(driver)).resolves.toBe(false);
  });
});
