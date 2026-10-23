import type { Pool } from 'mysql2/promise';
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

    const driver = new Mysql2Driver(pool as unknown as Pool);
    await driver.query('SELECT 1');
    await driver.query('SELECT 2');
    expect(session.queries).toEqual(['SELECT 1', 'SELECT 2']);
    await driver.close();
    expect(session.released).toBe(true);
  });

  it('forks a second pool connection and releases it without ending the pool', async () => {
    const sessions = [
      { released: false, threadId: 1, queries: [] as string[], async query(sql: string) { this.queries.push(sql); return [[{ ok: 1 }], []]; }, release() { this.released = true; } },
      { released: false, threadId: 2, queries: [] as string[], async query(sql: string) { this.queries.push(sql); return [[{ ok: 1 }], []]; }, release() { this.released = true; } },
    ];
    let checkout = 0;
    let ended = false;
    const pool = {
      async getConnection() {
        const session = sessions[checkout];
        checkout += 1;
        return session;
      },
      async end() {
        ended = true;
      },
    };

    const driver = new Mysql2Driver(pool as unknown as Pool);
    await driver.query('SELECT 1');
    const heartbeat = await driver.fork();
    await heartbeat.query('UPDATE migration_lock SET expires_at = ?', [1]);
    await heartbeat.close?.();
    expect(sessions[1].released).toBe(true);
    expect(sessions[1].queries).toEqual(['UPDATE migration_lock SET expires_at = ?']);
    expect(ended).toBe(false);
    expect(sessions[0].released).toBe(false);
    await driver.close();
    expect(sessions[0].released).toBe(true);
    expect(ended).toBe(true);
  });
});
