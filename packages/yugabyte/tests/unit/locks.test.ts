import { SqlDriver } from '@nodejs-db-migration-lock/core';
import { YugabyteTableLock } from '../../src/table-lock';

class MockDriver implements SqlDriver {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  rows: unknown[] = [{ id: '1' }];
  tableExists = false;
  createTableError: Error | null = null;
  ifNotExistsError: Error | null = null;
  schemaCheckErrorsBeforeSuccess = 0;

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push({ sql, params });
    if (/^select 1$/i.test(sql.trim())) {
      return [{ ok: 1 }] as T[];
    }
    if (/information_schema\.tables/i.test(sql)) {
      if (this.schemaCheckErrorsBeforeSuccess > 0) {
        this.schemaCheckErrorsBeforeSuccess -= 1;
        throw Object.assign(new Error('Restart read required'), { code: '40001' });
      }
      return [{ exists: this.tableExists }] as T[];
    }
    if (
      /^create table/i.test(sql.trim()) &&
      !/if not exists/i.test(sql) &&
      this.createTableError
    ) {
      throw this.createTableError;
    }
    if (/create table if not exists/i.test(sql) && this.ifNotExistsError) {
      throw this.ifNotExistsError;
    }
    if (/^create table/i.test(sql.trim())) {
      this.tableExists = true;
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
    expect(sql).toContain('information_schema.tables');
    expect(sql).toContain('CREATE TABLE "migration_lock"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "migration_lock"');
    expect(sql).not.toContain('pg_advisory_lock');
  });

  it('retries transient Yugabyte serialization errors during schema checks', async () => {
    const driver = new MockDriver();
    driver.schemaCheckErrorsBeforeSuccess = 2;
    await expect(new YugabyteTableLock().ensureInfrastructure(driver)).resolves.toBeUndefined();
    expect(
      driver.queries.filter((q) => /information_schema\.tables/i.test(q.sql)).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('tolerates duplicate DDL on CREATE TABLE IF NOT EXISTS', async () => {
    const driver = new MockDriver();
    driver.ifNotExistsError = Object.assign(new Error('type "migration_lock" already exists'), {
      code: '42710',
    });
    await expect(new YugabyteTableLock().ensureInfrastructure(driver)).resolves.toBeUndefined();
  });

  it('tolerates duplicate DDL when another migrator creates the table first', async () => {
    const driver = new MockDriver();
    driver.createTableError = Object.assign(new Error('type "migration_lock" already exists'), {
      code: '42710',
    });
    await expect(new YugabyteTableLock().ensureInfrastructure(driver)).resolves.toBeUndefined();
    expect(driver.queries.some((q) => q.sql.includes('CREATE TABLE IF NOT EXISTS'))).toBe(true);
  });

  it('upgrades an existing table with missing lease columns', async () => {
    const driver = new MockDriver();
    driver.tableExists = true;
    await new YugabyteTableLock().ensureInfrastructure(driver);
    const sql = driver.queries.map((query) => query.sql).join('\n');
    expect(sql).not.toContain('CREATE TABLE "migration_lock"');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS holder');
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
