import { MikroORMDriver, MikroOrmLike } from '../../src/mikro-orm-driver';

class Client {
  queries: string[] = [];
  released = false;

  async query(sql: string): Promise<{ rows: Array<{ ok: number }> }> {
    this.queries.push(sql);
    return { rows: [{ ok: 1 }] };
  }

  async release(): Promise<void> {
    this.released = true;
  }
}

function orm(): { orm: MikroOrmLike; clients: Client[]; closed: { value: boolean } } {
  const clients: Client[] = [];
  const closed = { value: false };
  const instance: MikroOrmLike = {
    async close() {
      closed.value = true;
    },
    em: {
      getConnection() {
        return {
          async getNativeClient() {
            return {
              async connect() {
                const client = new Client();
                clients.push(client);
                return client;
              },
            };
          },
        };
      },
    },
  };
  return { orm: instance, clients, closed };
}

describe('MikroORMDriver', () => {
  it('keeps lock queries on one checked-out client', async () => {
    const fixture = orm();
    const driver = new MikroORMDriver(fixture.orm);
    await driver.query('SELECT 1');
    await driver.query('SELECT 2');
    await driver.transaction(async () => 'ok');
    expect(fixture.clients).toHaveLength(1);
    expect(fixture.clients[0].queries).toEqual(['SELECT 1', 'SELECT 2', 'BEGIN', 'COMMIT']);
    await driver.close();
    expect(fixture.clients[0].released).toBe(true);
    expect(fixture.closed.value).toBe(true);
  });

  it('forks a second client and leaves the ORM open', async () => {
    const fixture = orm();
    const driver = new MikroORMDriver(fixture.orm);
    await driver.query('SELECT 1');
    const heartbeat = await driver.fork();
    await heartbeat.query('UPDATE migration_lock SET expires_at = 1');
    await heartbeat.close?.();
    expect(fixture.closed.value).toBe(false);
    expect(fixture.clients[1].released).toBe(true);
    expect(fixture.clients[0].released).toBe(false);
    await driver.close();
    expect(fixture.closed.value).toBe(true);
  });

  it('rejects a native client that cannot check out a session', async () => {
    const instance: MikroOrmLike = {
      async close() {
        return undefined;
      },
      em: {
        getConnection() {
          return { async getNativeClient() { return { query() { return []; } }; } };
        },
      },
    };
    const driver = new MikroORMDriver(instance);
    await expect(driver.query('SELECT 1')).rejects.toThrow(/connect\(\) or getConnection\(\)/);
  });
});
