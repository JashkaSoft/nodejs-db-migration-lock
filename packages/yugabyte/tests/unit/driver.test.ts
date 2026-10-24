import type { Pool } from 'pg';
import { YugabyteDriver } from '../../src/driver';

describe('YugabyteDriver', () => {
  it('pins one pool client and forks a second without ending the pool', async () => {
    const clients = [0, 1].map(() => ({
      released: false,
      release() {
        this.released = true;
      },
      async query() {
        return { rows: [{ ok: 1 }] };
      },
    }));
    let checkout = 0;
    let ended = false;
    const pool = {
      totalCount: 0,
      async connect() {
        const client = clients[checkout];
        checkout += 1;
        return client;
      },
      async end() {
        ended = true;
      },
    };

    const driver = new YugabyteDriver(pool as unknown as Pool);
    await driver.query('SELECT 1');
    const heartbeat = await driver.fork();
    await heartbeat.query('UPDATE migration_lock SET expires_at = $1', [1]);
    await heartbeat.close?.();
    expect(clients[1].released).toBe(true);
    expect(ended).toBe(false);
    await driver.close();
    expect(clients[0].released).toBe(true);
    expect(ended).toBe(true);
  });
});
