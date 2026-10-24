import type { Sequelize } from 'sequelize';
import { SequelizeDriver } from '../../src/sequelize-driver';

class MockSequelize {
  public dialect = 'postgres';
  public queries: Array<{ sql: string; options: Record<string, unknown> }> = [];
  public closed = false;
  public transactionCalled = false;
  public shouldFail = false;
  public nextResult: [unknown, unknown] = [[], undefined];

  getDialect(): string {
    return this.dialect;
  }

  async query(sql: string, options: Record<string, unknown>): Promise<[unknown, unknown]> {
    this.queries.push({ sql, options });
    if (this.shouldFail) {
      throw new Error('Sequelize query failed');
    }
    return this.nextResult;
  }

  async transaction(fn: (t: unknown) => Promise<unknown>): Promise<unknown> {
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
    expect(new SequelizeDriver(sequelize as unknown as Sequelize)).toBeDefined();
  });

  it('throws without a query function', () => {
    expect(() => new SequelizeDriver({} as unknown as Sequelize)).toThrow(
      'SequelizeDriver requires a Sequelize instance',
    );
  });

  it('uses bind for postgres', async () => {
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await driver.query('SELECT * FROM users WHERE id = $1', [1]);
    expect(sequelize.queries[0]).toEqual({
      sql: 'SELECT * FROM users WHERE id = $1',
      options: { raw: true, bind: [1] },
    });
  });

  it('uses replacements for mysql', async () => {
    sequelize.dialect = 'mysql';
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await driver.query('SELECT * FROM users WHERE id = ?', [1]);
    expect(sequelize.queries[0].options).toEqual({
      raw: true,
      replacements: [1],
    });
  });

  it('uses replacements for mariadb', async () => {
    sequelize.dialect = 'mariadb';
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await driver.query('SELECT 1', []);
    expect(sequelize.queries[0].options.replacements).toEqual([]);
  });

  it('omits bind when params are undefined', async () => {
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await driver.query('SELECT 1');
    expect(sequelize.queries[0].options).toEqual({ raw: true });
  });

  it('returns result rows', async () => {
    sequelize.nextResult = [[{ id: 1 }], undefined];
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await expect(driver.query('SELECT * FROM t')).resolves.toEqual([{ id: 1 }]);
  });

  it('wraps metadata when rows are empty', async () => {
    sequelize.nextResult = [[], { affectedRows: 1 }];
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await expect(driver.query('INSERT INTO t (id) VALUES (1)')).resolves.toEqual([
      { affectedRows: 1 },
    ]);
  });

  it('wraps numeric mysql metadata as affectedRows', async () => {
    sequelize.dialect = 'mysql';
    sequelize.nextResult = [[], 1];
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await expect(driver.query('INSERT INTO t (id) VALUES (1)')).resolves.toEqual([
      { affectedRows: 1 },
    ]);
  });

  it('returns ok packet rows from mysql insert results', async () => {
    sequelize.dialect = 'mysql';
    sequelize.nextResult = [[{ affectedRows: 2, insertId: 0, fieldCount: 0 }], undefined];
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await expect(driver.query('UPDATE t SET id = 1')).resolves.toEqual([
      { affectedRows: 2, insertId: 0, fieldCount: 0 },
    ]);
  });

  it('returns empty rows for mysql select with no matches', async () => {
    sequelize.dialect = 'mysql';
    sequelize.nextResult = [[], []];
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await expect(driver.query('SELECT holder FROM migration_lock WHERE id = ?', [1])).resolves.toEqual(
      [],
    );
  });

  it('maps sequelize insert tuple to affectedRows', async () => {
    sequelize.dialect = 'mysql';
    sequelize.nextResult = [0, 1];
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await expect(driver.query('INSERT INTO migration_lock (id) VALUES (1)')).resolves.toEqual([
      { affectedRows: 1 },
    ]);
  });

  it('propagates query errors', async () => {
    sequelize.shouldFail = true;
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await expect(driver.query('SELECT 1')).rejects.toThrow('Sequelize query failed');
  });

  it('runs a transaction and attaches it to queries', async () => {
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await expect(
      driver.transaction(async () => {
        await driver.query('SELECT 1');
        return 'success';
      }),
    ).resolves.toBe('success');
    expect(sequelize.transactionCalled).toBe(true);
    expect(sequelize.queries[0].options.transaction).toEqual({ id: 'tx' });
  });

  it('checks out one connection and keeps it for later queries', async () => {
    const connection = { id: 'pinned' };
    const manager = {
      getConnection: jest.fn(async () => connection),
      releaseConnection: jest.fn(async () => undefined),
    };
    (sequelize as MockSequelize & { connectionManager: typeof manager }).connectionManager = manager;

    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await driver.query('SELECT 1');
    await driver.query('SELECT 2');
    await driver.close();

    expect(manager.getConnection).toHaveBeenCalledTimes(1);
    expect(sequelize.queries[0].options.transaction).toEqual({ connection });
    expect(sequelize.queries[1].options.transaction).toEqual({ connection });
    expect(manager.releaseConnection).toHaveBeenCalledWith(connection);
    expect(sequelize.closed).toBe(true);
  });

  it('forks a second connection and leaves Sequelize open', async () => {
    const connections = [{ id: 'lock' }, { id: 'heartbeat' }];
    const manager = {
      getConnection: jest.fn(async () => connections.shift()),
      releaseConnection: jest.fn(async () => undefined),
    };
    (sequelize as MockSequelize & { connectionManager: typeof manager }).connectionManager = manager;

    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await driver.query('SELECT 1');
    const heartbeat = await driver.fork();
    await heartbeat.query('UPDATE migration_lock SET expires_at = ?', [1]);
    await heartbeat.close?.();
    expect(manager.releaseConnection).toHaveBeenCalledWith({ id: 'heartbeat' });
    expect(sequelize.closed).toBe(false);
    await driver.close();
    expect(manager.releaseConnection).toHaveBeenCalledWith({ id: 'lock' });
    expect(sequelize.closed).toBe(true);
  });

  it('closes the Sequelize instance', async () => {
    const driver = new SequelizeDriver(sequelize as unknown as Sequelize);
    await driver.close();
    expect(sequelize.closed).toBe(true);
  });
});
