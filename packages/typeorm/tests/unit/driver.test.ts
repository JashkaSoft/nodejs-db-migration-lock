import { TypeORMDriver } from '../../src/typeorm-driver';

class MockDataSource {
  public isInitialized = true;
  public queries: Array<{ sql: string; params?: any[] }> = [];
  public shouldFail = false;
  public transactionCalled = false;

  async query(sql: string, params?: any[]): Promise<any> {
    this.queries.push({ sql, params });
    if (this.shouldFail) {
      throw new Error('TypeORM query failed');
    }
    return [];
  }

  async transaction(fn: (manager: any) => Promise<any>): Promise<any> {
    this.transactionCalled = true;
    return fn({ query: this.query.bind(this) });
  }

  async destroy(): Promise<void> {
    this.isInitialized = false;
  }
}

describe('TypeORMDriver', () => {
  let dataSource: MockDataSource;

  beforeEach(() => {
    dataSource = new MockDataSource();
  });

  it('creates a driver with an initialized DataSource', () => {
    expect(new TypeORMDriver(dataSource)).toBeDefined();
  });

  it('throws if DataSource is not initialized', () => {
    dataSource.isInitialized = false;
    expect(() => new TypeORMDriver(dataSource)).toThrow(
      'TypeORM DataSource must be initialized',
    );
  });

  it('delegates query', async () => {
    const driver = new TypeORMDriver(dataSource);
    await driver.query('SELECT * FROM users', [1, 2]);
    expect(dataSource.queries[0]).toEqual({
      sql: 'SELECT * FROM users',
      params: [1, 2],
    });
  });

  it('wraps a non-array result as a single row', async () => {
    dataSource.query = async () => ({ affectedRows: 1 });
    const driver = new TypeORMDriver(dataSource);
    await expect(driver.query('INSERT INTO t (id) VALUES (1)')).resolves.toEqual([
      { affectedRows: 1 },
    ]);
  });

  it('propagates query errors', async () => {
    dataSource.shouldFail = true;
    const driver = new TypeORMDriver(dataSource);
    await expect(driver.query('SELECT 1')).rejects.toThrow('TypeORM query failed');
  });

  it('runs a transaction', async () => {
    const driver = new TypeORMDriver(dataSource);
    await expect(driver.transaction(async () => 'success')).resolves.toBe('success');
    expect(dataSource.transactionCalled).toBe(true);
  });

  it('destroys the DataSource on close', async () => {
    const driver = new TypeORMDriver(dataSource);
    await driver.close();
    expect(dataSource.isInitialized).toBe(false);
    await driver.close();
  });
});
