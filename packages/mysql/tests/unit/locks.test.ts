import { MySQLAdvisoryLock } from '../../src/advisory-lock';
import { MySQLTableLock } from '../../src/table-lock';
import { MockMysqlDriver } from './mocks';

describe('MySQLAdvisoryLock', () => {
  it('acquires when GET_LOCK returns 1', async () => {
    const driver = new MockMysqlDriver();
    const lock = new MySQLAdvisoryLock({ lockName: 'mig' });
    await expect(lock.acquire(driver)).resolves.toBe(true);
    expect(driver.queries[0].sql).toContain('GET_LOCK');
    expect(driver.queries[0].params).toEqual(['mig', 0]);
  });

  it('fails acquire when GET_LOCK returns 0', async () => {
    const driver = new MockMysqlDriver();
    driver.acquireResult = 0;
    const lock = new MySQLAdvisoryLock({ lockName: 'nodejs_db_migration_lock' });
    await expect(lock.acquire(driver)).resolves.toBe(false);
  });

  it('releases with RELEASE_LOCK', async () => {
    const driver = new MockMysqlDriver();
    const lock = new MySQLAdvisoryLock({ lockName: 'nodejs_db_migration_lock' });
    await lock.release(driver);
    expect(driver.queries[0].sql).toContain('RELEASE_LOCK');
  });
});

describe('MySQLTableLock', () => {
  it('creates lock table under a DDL named lock', async () => {
    const driver = new MockMysqlDriver();
    const lock = new MySQLTableLock({ tableName: 'migration_lock' });
    await lock.ensureInfrastructure(driver);
    const sql = driver.queries.map((q) => q.sql).join('\n');
    expect(sql).toContain('GET_LOCK');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sql).toContain('RELEASE_LOCK');
  });

  it('acquires when insert affects a row', async () => {
    const driver = new MockMysqlDriver();
    const lock = new MySQLTableLock();
    await expect(lock.acquire(driver)).resolves.toBe(true);
  });

  it('does not acquire when insert is ignored', async () => {
    const driver = new MockMysqlDriver();
    driver.insertAffectedRows = 0;
    const lock = new MySQLTableLock();
    await expect(lock.acquire(driver)).resolves.toBe(false);
  });

  it('rejects unsafe table names', async () => {
    const driver = new MockMysqlDriver();
    const lock = new MySQLTableLock({ tableName: 'lock;drop' });
    await expect(lock.ensureInfrastructure(driver)).rejects.toThrow(
      'Invalid SQL identifier',
    );
  });
});
