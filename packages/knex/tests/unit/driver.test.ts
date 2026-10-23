import type { Knex } from 'knex';
import { KnexDriver } from '../../src/knex-driver';

class MockKnex {
  public calls: Array<{ sql: string; params?: unknown[]; connection?: unknown }> = [];
  public nextResult: unknown = { rows: [] };
  public shouldFail = false;
  public destroyed = false;
  public transactionCalled = false;

  async raw(sql: string, params?: unknown[]): Promise<unknown> {
    this.calls.push({ sql, params });
    if (this.shouldFail) {
      throw new Error('Knex query failed');
    }
    return this.nextResult;
  }

  async transaction(fn: (trx: MockKnex) => Promise<unknown>): Promise<unknown> {
    this.transactionCalled = true;
    const trx = new MockKnex();
    trx.nextResult = this.nextResult;
    return fn(trx);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
  }
}

describe('KnexDriver', () => {
  let knex: MockKnex;

  beforeEach(() => {
    knex = new MockKnex();
  });

  it('creates a driver with a Knex instance', () => {
    expect(new KnexDriver(knex as unknown as Knex)).toBeDefined();
  });

  it('throws without a raw function', () => {
    expect(() => new KnexDriver({} as unknown as Knex)).toThrow('KnexDriver requires a Knex instance');
  });

  it('delegates raw queries with params', async () => {
    const driver = new KnexDriver(knex as unknown as Knex);
    await driver.query('SELECT * FROM users WHERE id = $1', [1]);
    expect(knex.calls[0]).toEqual({
      sql: 'SELECT * FROM users WHERE id = ?',
      params: [1],
    });
  });

  it('omits params when undefined', async () => {
    const driver = new KnexDriver(knex as unknown as Knex);
    await driver.query('SELECT 1');
    expect(knex.calls[0]).toEqual({ sql: 'SELECT 1', params: undefined });
  });

  it('returns postgres-style rows', async () => {
    knex.nextResult = { rows: [{ id: 1 }] };
    const driver = new KnexDriver(knex as unknown as Knex);
    await expect(driver.query('SELECT * FROM t')).resolves.toEqual([{ id: 1 }]);
  });

  it('unwraps mysql row arrays', async () => {
    knex.nextResult = [[{ id: 2 }], []];
    const driver = new KnexDriver(knex as unknown as Knex);
    await expect(driver.query('SELECT * FROM t')).resolves.toEqual([{ id: 2 }]);
  });

  it('wraps mysql result metadata as a single row', async () => {
    knex.nextResult = [{ affectedRows: 1 }, undefined];
    const driver = new KnexDriver(knex as unknown as Knex);
    await expect(driver.query('INSERT IGNORE INTO t (id) VALUES (?)')).resolves.toEqual([
      { affectedRows: 1 },
    ]);
  });

  it('propagates query errors', async () => {
    knex.shouldFail = true;
    const driver = new KnexDriver(knex as unknown as Knex);
    await expect(driver.query('SELECT 1')).rejects.toThrow('Knex query failed');
  });

  it('runs a transaction against the trx client', async () => {
    const driver = new KnexDriver(knex as unknown as Knex);
    await expect(
      driver.transaction(async () => {
        await driver.query('SELECT 1');
        return 'success';
      }),
    ).resolves.toBe('success');
    expect(knex.transactionCalled).toBe(true);
    expect(knex.calls).toHaveLength(0);
  });

  it('checks out one client connection and runs lock SQL on it', async () => {
    const connection = { id: 'pinned' };
    const client = {
      acquireConnection: jest.fn(async () => connection),
      releaseConnection: jest.fn(async () => undefined),
    };
    (knex as MockKnex & { client: typeof client }).client = client;
    knex.raw = (sql: string, params?: unknown[]) => {
      const builder = Promise.resolve(knex.nextResult) as Promise<unknown> & {
        connection?: (pinned: unknown) => Promise<unknown>;
      };
      builder.connection = (pinned: unknown) => {
        knex.calls.push({ sql, params, connection: pinned });
        return Promise.resolve(knex.nextResult);
      };
      return builder;
    };

    const driver = new KnexDriver(knex as unknown as Knex);
    await driver.query('SELECT pg_advisory_lock($1)', [1]);
    await driver.query('SELECT 1');
    await driver.close();

    expect(client.acquireConnection).toHaveBeenCalledTimes(1);
    expect(knex.calls[0]).toMatchObject({
      sql: 'SELECT pg_advisory_lock(?)',
      params: [1],
      connection,
    });
    expect(knex.calls[1].connection).toBe(connection);
    expect(client.releaseConnection).toHaveBeenCalledWith(connection);
    expect(knex.destroyed).toBe(true);
  });

  it('destroys the Knex instance on close', async () => {
    const driver = new KnexDriver(knex as unknown as Knex);
    await driver.close();
    expect(knex.destroyed).toBe(true);
  });
});
