import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { NodeSqliteDriver, SqliteTableLock } from '@nodejs-db-migration-lock/sqlite';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';
const SQLITE_PATH = process.env.SQLITE_PATH || '/data/migration_test.db';

mkdirSync(dirname(SQLITE_PATH), { recursive: true });
const db = new DatabaseSync(SQLITE_PATH, { timeout: 5000 });

class SqliteTestRunner implements MigrationRunner {
  constructor(private readonly processId: string) {}

  async run(): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        created_by TEXT
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT NOT NULL,
        content TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        created_by TEXT
      )
    `);
    db.prepare(
      'INSERT OR IGNORE INTO users (email, name, created_by) VALUES (?, ?, ?)',
    ).run(
      `process-${this.processId}@test.com`,
      `Process ${this.processId}`,
      this.processId,
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function logAttempt(status: string, started: Date, error?: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_id TEXT,
      started_at TEXT,
      completed_at TEXT,
      status TEXT,
      lock_strategy TEXT,
      error_message TEXT
    )
  `);
  db.prepare(
    `INSERT INTO migration_logs (process_id, started_at, completed_at, status, lock_strategy, error_message)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    PROCESS_ID,
    started.toISOString(),
    new Date().toISOString(),
    status,
    'table',
    error ?? null,
  );
}

async function runMigration(): Promise<void> {
  const driver = new NodeSqliteDriver(db);
  let started = new Date();
  try {
    const coordinator = new MigrationCoordinator({
      driver,
      lockProvider: new SqliteTableLock(),
      migrationRunner: new SqliteTestRunner(PROCESS_ID),
      retryConfig: { maxRetries: 30, retryIntervalMs: 1000 },
      onLockWaiting: (attempt, max) =>
        console.log(`[Process ${PROCESS_ID}] Waiting for lock... (${attempt}/${max})`),
      onLockAcquired: () => {
        started = new Date();
        console.log(`[Process ${PROCESS_ID}] Lock acquired`);
      },
    });
    await coordinator.migrate();
    logAttempt('completed', started);
    console.log(`[Process ${PROCESS_ID}] Migration process completed successfully`);
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Process ${PROCESS_ID}] Migration failed:`, message);
    try {
      logAttempt('failed', started, message);
    } catch {}
  } finally {
    await driver.close().catch(() => undefined);
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
