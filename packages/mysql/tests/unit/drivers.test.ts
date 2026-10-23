import { Mysql2Driver } from '../../src/mysql2-driver';

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
