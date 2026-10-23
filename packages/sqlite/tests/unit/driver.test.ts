import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NodeSqliteDriver } from '../../src/node-sqlite-driver';

function asDatabase(db: MockDatabase | Record<string, never>): DatabaseSync {
  return db as unknown as DatabaseSync;
}

class MockStatement {
  constructor(
    private readonly db: MockDatabase,
    private readonly sql: string,
  ) {}

  all(...params: unknown[]) {
    this.db.calls.push({ sql: this.sql, params, kind: 'all' });
    return [{ id: 1 }];
  }

  run(...params: unknown[]) {
    this.db.calls.push({ sql: this.sql, params, kind: 'run' });
    return { changes: 1, lastInsertRowid: 7 };
  }
}

class MockDatabase {
  public execs: string[] = [];
  public calls: Array<{ sql: string; params: unknown[]; kind: string }> = [];
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
    expect(() => new NodeSqliteDriver(asDatabase({}))).toThrow(
      'NodeSqliteDriver requires a node:sqlite DatabaseSync',
    );
  });

  it('enables WAL and a busy timeout', () => {
    const db = new MockDatabase();
    new NodeSqliteDriver(asDatabase(db));
    expect(db.execs.join('\n')).toContain('busy_timeout');
    expect(db.execs.join('\n')).toContain('journal_mode = WAL');
  });

  it('uses all() for SELECT and run() for DML', async () => {
    const db = new MockDatabase();
    const driver = new NodeSqliteDriver(asDatabase(db));
    await expect(driver.query('SELECT 1')).resolves.toEqual([{ id: 1 }]);
    await expect(driver.query('INSERT OR IGNORE INTO t (id) VALUES (?)', [1])).resolves.toEqual([
      { changes: 1, affectedRows: 1, lastInsertRowid: 7 },
    ]);
    expect(db.calls.map((c) => c.kind)).toEqual(['all', 'run']);
  });

  it('runs BEGIN IMMEDIATE transactions', async () => {
    const db = new MockDatabase();
    const driver = new NodeSqliteDriver(asDatabase(db));
    await expect(driver.transaction(async () => 'ok')).resolves.toBe('ok');
    expect(db.execs).toContain('BEGIN IMMEDIATE');
    expect(db.execs).toContain('COMMIT');
  });

  it('rolls back a failed transaction', async () => {
    const db = new MockDatabase();
    const driver = new NodeSqliteDriver(asDatabase(db));
    await expect(
      driver.transaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(db.execs).toContain('ROLLBACK');
  });

  it('closes the database', async () => {
    const db = new MockDatabase();
    const driver = new NodeSqliteDriver(asDatabase(db));
    await driver.close();
    expect(db.closed).toBe(true);
  });

  it('forks a second connection to the same file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sqlite-fork-'));
    const driver = new NodeSqliteDriver(new DatabaseSync(join(dir, 'app.db')));
    const heartbeat = await driver.fork();
    await driver.query('CREATE TABLE t (id INTEGER)');
    await heartbeat.query('INSERT INTO t (id) VALUES (?)', [1]);
    await expect(driver.query('SELECT id FROM t')).resolves.toEqual([{ id: 1 }]);
    await heartbeat.close?.();
    await expect(driver.query('SELECT id FROM t')).resolves.toEqual([{ id: 1 }]);
    await driver.close();
  });

  it('refuses to fork an in-memory database', async () => {
    const driver = new NodeSqliteDriver(new DatabaseSync(':memory:'));
    await expect(driver.fork()).rejects.toThrow('file-backed');
    await driver.close();
  });
});
