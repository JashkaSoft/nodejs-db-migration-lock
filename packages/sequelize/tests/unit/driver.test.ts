import { SequelizeDriver } from '../../src/sequelize-driver';

class MockSequelize {
  public dialect = 'postgres';
  public queries: Array<{ sql: string; options: any }> = [];
  public closed = false;
  public transactionCalled = false;
  public shouldFail = false;
  public nextResult: [any, any] = [[], undefined];

  getDialect(): string {
    return this.dialect;
  }

  async query(sql: string, options: any): Promise<[any, any]> {
    this.queries.push({ sql, options });
    if (this.shouldFail) {
      throw new Error('Sequelize query failed');
    }
    return this.nextResult;
  }

  async transaction(fn: (t: unknown) => Promise<any>): Promise<any> {
    this.transactionCalled = true;
    return fn({ id: 'tx' });
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('SequelizeDriver', () => {
  let sequelize: MockSequelize;

  beforeEach(() => {
    sequelize = new MockSequelize();
  });

  it('creates a driver with a Sequelize instance', () => {
    expect(new SequelizeDriver(sequelize)).toBeDefined();
  });

  it('throws without a query function', () => {
    expect(() => new SequelizeDriver({})).toThrow(
      'SequelizeDriver requires a Sequelize instance',
    );
  });

  it('uses bind for postgres', async () => {
    const driver = new SequelizeDriver(sequelize);
    await driver.query('SELECT * FROM users WHERE id = $1', [1]);
    expect(sequelize.queries[0]).toEqual({
      sql: 'SELECT * FROM users WHERE id = $1',
      options: { raw: true, bind: [1] },
    });
  });

  it('uses replacements for mysql', async () => {
    sequelize.dialect = 'mysql';
    const driver = new SequelizeDriver(sequelize);
    await driver.query('SELECT * FROM users WHERE id = ?', [1]);
    expect(sequelize.queries[0].options).toEqual({
      raw: true,
      replacements: [1],
    });
  });

  it('uses replacements for mariadb', async () => {
    sequelize.dialect = 'mariadb';
    const driver = new SequelizeDriver(sequelize);
    await driver.query('SELECT 1', []);
    expect(sequelize.queries[0].options.replacements).toEqual([]);
  });

  it('omits bind when params are undefined', async () => {
    const driver = new SequelizeDriver(sequelize);
    await driver.query('SELECT 1');
    expect(sequelize.queries[0].options).toEqual({ raw: true });
  });

  it('returns result rows', async () => {
    sequelize.nextResult = [[{ id: 1 }], undefined];
    const driver = new SequelizeDriver(sequelize);
    await expect(driver.query('SELECT * FROM t')).resolves.toEqual([{ id: 1 }]);
  });

  it('wraps metadata when rows are empty', async () => {
    sequelize.nextResult = [[], { affectedRows: 1 }];
    const driver = new SequelizeDriver(sequelize);
    await expect(driver.query('INSERT INTO t (id) VALUES (1)')).resolves.toEqual([
      { affectedRows: 1 },
    ]);
  });

  it('propagates query errors', async () => {
    sequelize.shouldFail = true;
    const driver = new SequelizeDriver(sequelize);
    await expect(driver.query('SELECT 1')).rejects.toThrow('Sequelize query failed');
  });

  it('runs a transaction and attaches it to queries', async () => {
    const driver = new SequelizeDriver(sequelize);
    await expect(
      driver.transaction(async () => {
        await driver.query('SELECT 1');
        return 'success';
      }),
    ).resolves.toBe('success');
    expect(sequelize.transactionCalled).toBe(true);
    expect(sequelize.queries[0].options.transaction).toEqual({ id: 'tx' });
  });

  it('closes the Sequelize instance', async () => {
    const driver = new SequelizeDriver(sequelize);
    await driver.close();
    expect(sequelize.closed).toBe(true);
  });
});
