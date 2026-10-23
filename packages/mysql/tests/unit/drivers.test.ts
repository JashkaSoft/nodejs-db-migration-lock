import { Mysql2Driver } from '../../src/mysql2-driver';
import { TypeORMDriver } from '../../src/typeorm-driver';

describe('Mysql2Driver', () => {
  it('pins a pool connection for all queries', async () => {
    const session = {
      queries: [] as string[],
      released: false,
      async query(sql: string) {
        this.queries.push(sql);
        return [[{ ok: true }], []];
      },
      release() {
        this.released = true;
      },
    };
    const pool = {
      async getConnection() {
        return session;
      },
      async query() {
        throw new Error('pool.query should not run');
      },
      async end() {
        return undefined;
      },
    };

    const driver = new Mysql2Driver(pool as any);
    await driver.query('SELECT 1');
    await driver.query('SELECT 2');
    expect(session.queries).toEqual(['SELECT 1', 'SELECT 2']);
    await driver.close();
    expect(session.released).toBe(true);
  });
});

describe('TypeORMDriver', () => {
  it('requires an initialized DataSource', () => {
    expect(() => new TypeORMDriver({ isInitialized: false })).toThrow(
      'must be initialized',
    );
  });

  it('delegates query to DataSource', async () => {
    const dataSource = {
      isInitialized: true,
      async query(sql: string, params?: any[]) {
        return [{ sql, params }];
      },
    };
    const driver = new TypeORMDriver(dataSource);
    await expect(driver.query('SELECT 1', [1])).resolves.toEqual([
      { sql: 'SELECT 1', params: [1] },
    ]);
  });
});
