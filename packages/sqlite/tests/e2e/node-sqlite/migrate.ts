import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { NodeSqliteDriver, SqliteTableLock } from '@nodejs-db-migration-lock/sqlite';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';
const SQLITE_PATH = process.env.SQLITE_PATH || '/data/migration_test.db';

const MIGRATION_STEPS = 25;

function openDatabase(): DatabaseSync {
  mkdirSync(dirname(SQLITE_PATH), { recursive: true });
  return new DatabaseSync(SQLITE_PATH, { timeout: 5000 });
}

class SqliteTestRunner implements MigrationRunner {
  constructor(
    private readonly db: DatabaseSync,
    private readonly processId: string,
  ) {}

  async run(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        created_by TEXT
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        title TEXT NOT NULL,
        content TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        created_by TEXT
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migration_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        process_id TEXT NOT NULL,
        step INTEGER NOT NULL
      )
    `);
    const insertStep = this.db.prepare(
      'INSERT INTO migration_steps (process_id, step) VALUES (?, ?)',
    );
    for (let step = 1; step <= MIGRATION_STEPS; step += 1) {
      insertStep.run(this.processId, step);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    this.db.prepare(
      'INSERT OR IGNORE INTO users (email, name, created_by) VALUES (?, ?, ?)',
    ).run(
      `process-${this.processId}@test.com`,
      `Process ${this.processId}`,
      this.processId,
    );
  }
}

function logAttempt(db: DatabaseSync, status: string, started: Date, error?: string): void {
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
  const db = openDatabase();
  const driver = new NodeSqliteDriver(db);
  let started = new Date();
  try {
    const coordinator = new MigrationCoordinator({
      driver,
      // Shorter than the 25-step run, so a missed heartbeat lets another process in.
      lockProvider: new SqliteTableLock({ leaseMs: 2000 }),
      migrationRunner: new SqliteTestRunner(db, PROCESS_ID),
      renewIntervalMs: 500,
      retryConfig: { maxRetries: 60, retryIntervalMs: 500, timeoutMs: 120000 },
      onLockWaiting: (attempt, max) =>
        console.log(`[Process ${PROCESS_ID}] Waiting for lock... (${attempt}/${max})`),
      onLockAcquired: () => {
        started = new Date();
        console.log(`[Process ${PROCESS_ID}] Lock acquired`);
      },
    });
    await coordinator.migrate();
    logAttempt(db, 'completed', started);
    console.log(`[Process ${PROCESS_ID}] Migration process completed successfully`);
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Process ${PROCESS_ID}] Migration failed:`, message);
    try {
      logAttempt(db, 'failed', started, message);
    } catch {}
  } finally {
    await driver.close().catch(() => undefined);
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
