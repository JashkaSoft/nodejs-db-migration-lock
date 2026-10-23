import { NodeSqliteDriver } from '../../src/node-sqlite-driver';

class MockStatement {
  constructor(
    private readonly db: MockDatabase,
    private readonly sql: string,
  ) {}

  all(...params: any[]) {
    this.db.calls.push({ sql: this.sql, params, kind: 'all' });
    return [{ id: 1 }];
  }

  run(...params: any[]) {
    this.db.calls.push({ sql: this.sql, params, kind: 'run' });
    return { changes: 1, lastInsertRowid: 7 };
  }
}

class MockDatabase {
  public execs: string[] = [];
  public calls: Array<{ sql: string; params: any[]; kind: string }> = [];
  public closed = false;

  exec(sql: string) {
    this.execs.push(sql);
  }

  prepare(sql: string) {
    return new MockStatement(this, sql);
  }

  close() {
    this.closed = true;
  }
}

describe('NodeSqliteDriver', () => {
  it('throws without prepare', () => {
    expect(() => new NodeSqliteDriver({})).toThrow(
      'NodeSqliteDriver requires a node:sqlite DatabaseSync',
    );
  });

  it('enables WAL and a busy timeout', () => {
    const db = new MockDatabase();
    new NodeSqliteDriver(db);
    expect(db.execs.join('\n')).toContain('busy_timeout');
    expect(db.execs.join('\n')).toContain('journal_mode = WAL');
  });

  it('uses all() for SELECT and run() for DML', async () => {
    const db = new MockDatabase();
    const driver = new NodeSqliteDriver(db);
    await expect(driver.query('SELECT 1')).resolves.toEqual([{ id: 1 }]);
    await expect(driver.query('INSERT OR IGNORE INTO t (id) VALUES (?)', [1])).resolves.toEqual([
      { changes: 1, affectedRows: 1, lastInsertRowid: 7 },
    ]);
    expect(db.calls.map((c) => c.kind)).toEqual(['all', 'run']);
  });

  it('runs BEGIN IMMEDIATE transactions', async () => {
    const db = new MockDatabase();
    const driver = new NodeSqliteDriver(db);
    await expect(driver.transaction(async () => 'ok')).resolves.toBe('ok');
    expect(db.execs).toContain('BEGIN IMMEDIATE');
    expect(db.execs).toContain('COMMIT');
  });

  it('rolls back a failed transaction', async () => {
    const db = new MockDatabase();
    const driver = new NodeSqliteDriver(db);
    await expect(
      driver.transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(db.execs).toContain('ROLLBACK');
  });

  it('closes the database', async () => {
    const db = new MockDatabase();
    const driver = new NodeSqliteDriver(db);
    await driver.close();
    expect(db.closed).toBe(true);
  });
});
