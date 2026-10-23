import type { DataSource } from 'typeorm';
import { TypeORMDriver } from '../../src/typeorm-driver';

function asDataSource(source: MockDataSource): DataSource {
  return source as unknown as DataSource;
}

class MockDataSource {
  public isInitialized = true;
  public queries: Array<{ sql: string; params?: unknown[] }> = [];
  public shouldFail = false;
  public transactionCalled = false;

  async query(sql: string, params?: unknown[]): Promise<unknown> {
    this.queries.push({ sql, params });
    if (this.shouldFail) {
      throw new Error('TypeORM query failed');
    }
    return [];
  }

  async transaction(fn: (manager: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<unknown>): Promise<unknown> {
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
    expect(new TypeORMDriver(asDataSource(dataSource))).toBeDefined();
  });

  it('throws if DataSource is not initialized', () => {
    dataSource.isInitialized = false;
    expect(() => new TypeORMDriver(asDataSource(dataSource))).toThrow(
      'TypeORM DataSource must be initialized',
    );
  });

  it('delegates query', async () => {
    const driver = new TypeORMDriver(asDataSource(dataSource));
    await driver.query('SELECT * FROM users', [1, 2]);
    expect(dataSource.queries[0]).toEqual({
      sql: 'SELECT * FROM users',
      params: [1, 2],
    });
  });

  it('wraps a non-array result as a single row', async () => {
    dataSource.query = async () => ({ affectedRows: 1 });
    const driver = new TypeORMDriver(asDataSource(dataSource));
    await expect(driver.query('INSERT INTO t (id) VALUES (1)')).resolves.toEqual([
      { affectedRows: 1 },
    ]);
  });

  it('propagates query errors', async () => {
    dataSource.shouldFail = true;
    const driver = new TypeORMDriver(asDataSource(dataSource));
    await expect(driver.query('SELECT 1')).rejects.toThrow('TypeORM query failed');
  });

  it('runs a transaction', async () => {
    const driver = new TypeORMDriver(asDataSource(dataSource));
    await expect(driver.transaction(async () => 'success')).resolves.toBe('success');
    expect(dataSource.transactionCalled).toBe(true);
  });

  it('reuses one query runner for session locks', async () => {
    const runner = {
      isReleased: false,
      queries: [] as Array<{ sql: string; params?: unknown[] }>,
      connect: jest.fn(async () => undefined),
      query: jest.fn(async (sql: string, params?: unknown[]) => {
        runner.queries.push({ sql, params });
        return [];
      }),
      startTransaction: jest.fn(async () => undefined),
      commitTransaction: jest.fn(async () => undefined),
      rollbackTransaction: jest.fn(async () => undefined),
      release: jest.fn(async () => {
        runner.isReleased = true;
      }),
    };
    (dataSource as MockDataSource & { createQueryRunner: () => typeof runner }).createQueryRunner = () => runner;

    const driver = new TypeORMDriver(asDataSource(dataSource));
    await driver.query('SELECT 1');
    await driver.query('SELECT 2');
    await driver.transaction(async () => 'ok');
    await driver.close();

    expect(runner.connect).toHaveBeenCalledTimes(1);
    expect(runner.queries.map((query) => query.sql)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(dataSource.isInitialized).toBe(false);
  });

  it('forks a second query runner and leaves the DataSource open', async () => {
    function makeRunner() {
      const runner = {
        isReleased: false,
        queries: [] as string[],
        connect: jest.fn(async () => undefined),
        query: jest.fn(async (sql: string) => {
          runner.queries.push(sql);
          return [{ ok: 1 }];
        }),
        startTransaction: jest.fn(async () => undefined),
        commitTransaction: jest.fn(async () => undefined),
        rollbackTransaction: jest.fn(async () => undefined),
        release: jest.fn(async () => {
          runner.isReleased = true;
        }),
      };
      return runner;
    }
    const lockRunner = makeRunner();
    const heartbeatRunner = makeRunner();
    (dataSource as MockDataSource & { createQueryRunner: () => ReturnType<typeof makeRunner> }).createQueryRunner =
      jest.fn()
        .mockReturnValueOnce(lockRunner)
        .mockReturnValueOnce(heartbeatRunner);

    const driver = new TypeORMDriver(asDataSource(dataSource));
    await driver.query('SELECT 1');
    const heartbeat = await driver.fork();
    await heartbeat.query('UPDATE migration_lock SET expires_at = $1', [1]);
    await heartbeat.close?.();
    expect(heartbeatRunner.queries).toEqual(['UPDATE migration_lock SET expires_at = $1']);
    expect(heartbeatRunner.isReleased).toBe(true);
    expect(lockRunner.isReleased).toBe(false);
    expect(dataSource.isInitialized).toBe(true);
    await driver.close();
    expect(lockRunner.isReleased).toBe(true);
    expect(dataSource.isInitialized).toBe(false);
  });

  it('destroys the DataSource on close', async () => {
    const driver = new TypeORMDriver(asDataSource(dataSource));
    await driver.close();
    expect(dataSource.isInitialized).toBe(false);
    await driver.close();
  });
});
