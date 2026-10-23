import { Request } from 'tedious';
import { TediousDriver } from '../../src/tedious-driver';

class FakeConnection {
  public requests: Request[] = [];
  private listeners = new Map<string, Array<(error?: Error) => void>>();

  on(event: 'connect' | 'end', listener: (error?: Error) => void): void {
    const current = this.listeners.get(event) ?? [];
    current.push(listener);
    this.listeners.set(event, current);
  }

  connect(): void {
    // Already open for unit tests.
  }

  close(): void {
    for (const listener of this.listeners.get('end') ?? []) {
      listener();
    }
  }

  execSql(request: Request): void {
    this.requests.push(request);
    request.callback(null);
  }
}

describe('TediousDriver', () => {
  it('runs queries on the supplied connection and can commit a transaction', async () => {
    const connection = new FakeConnection();
    const driver = new TediousDriver(connection);
    await driver.query('SELECT 1 AS ok', []);
    await driver.transaction(async () => 'done');
    await driver.close();

    expect(connection.requests.map((request) => request.sqlTextOrProcedure)).toEqual([
      'SELECT 1 AS ok',
      'BEGIN TRANSACTION',
      'COMMIT TRANSACTION',
    ]);
  });

  it('rolls back when the transaction body throws', async () => {
    const connection = new FakeConnection();
    const driver = new TediousDriver(connection);

    await expect(
      driver.transaction(async () => {
        throw new Error('nope');
      }),
    ).rejects.toThrow('nope');

    expect(connection.requests.map((request) => request.sqlTextOrProcedure)).toEqual([
      'BEGIN TRANSACTION',
      'ROLLBACK TRANSACTION',
    ]);
  });
});
