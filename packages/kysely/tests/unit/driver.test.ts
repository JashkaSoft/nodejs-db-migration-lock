import type { DatabaseConnection, Kysely } from 'kysely';
import { KyselyDriver } from '../../src/kysely-driver';

class MockConnection {
  queries: string[] = [];

  async executeQuery(compiled: { sql: string }): Promise<{ rows: Array<{ ok: number }> }> {
    this.queries.push(compiled.sql);
    return { rows: [{ ok: 1 }] };
  }
}

function database(): { db: Kysely<any>; connections: MockConnection[]; destroyed: { value: boolean } } {
  const connections: MockConnection[] = [];
  const destroyed = { value: false };
  const db = {
    getExecutor() {
      return {
        provideConnection(consumer: (connection: DatabaseConnection) => Promise<void>) {
          const connection = new MockConnection();
          connections.push(connection);
          return consumer(connection as never);
        },
      };
    },
    async destroy() {
      destroyed.value = true;
    },
  };
  return { db: db as unknown as Kysely<any>, connections, destroyed };
}

describe('KyselyDriver', () => {
  it('holds one connection for every lock query', async () => {
    const fixture = database();
    const driver = new KyselyDriver(fixture.db);
    await driver.query('SELECT 1');
    await driver.query('SELECT 2');
    await driver.transaction(async () => 'ok');
    expect(fixture.connections).toHaveLength(1);
    expect(fixture.connections[0].queries).toEqual(['SELECT 1', 'SELECT 2', 'BEGIN', 'COMMIT']);
    await driver.close();
    expect(fixture.destroyed.value).toBe(true);
  });

  it('forks a second connection and leaves Kysely open', async () => {
    const fixture = database();
    const driver = new KyselyDriver(fixture.db);
    await driver.query('SELECT 1');
    const heartbeat = await driver.fork();
    await heartbeat.query('UPDATE migration_lock SET expires_at = 1');
    await heartbeat.close?.();
    expect(fixture.destroyed.value).toBe(false);
    expect(fixture.connections).toHaveLength(2);
    await driver.close();
    expect(fixture.destroyed.value).toBe(true);
  });

  it('requires a Kysely instance', () => {
    expect(() => new KyselyDriver(undefined as unknown as Kysely<any>)).toThrow(/Kysely instance/);
  });
});
