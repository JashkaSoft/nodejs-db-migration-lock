import { DatabaseSync } from 'node:sqlite';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { NodeSqliteDriver, SqliteTableLock } from '@nodejs-db-migration-lock/sqlite';

class SqliteSchemaRunner implements MigrationRunner {
  constructor(private readonly db: DatabaseSync) {}

  async run(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL
      )
    `);
  }
}

export async function runLockedMigrations(db: DatabaseSync): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';

  const coordinator = new MigrationCoordinator({
    driver: new NodeSqliteDriver(db),
    lockProvider: new SqliteTableLock(),
    migrationRunner: new SqliteSchemaRunner(db),
    retryConfig: { maxRetries: 60, retryIntervalMs: 1000 },
    onLockWaiting: (attempt, max) =>
      console.log(`[replica ${replica}] waiting for migration lock (${attempt}/${max})`),
    onLockAcquired: () => console.log(`[replica ${replica}] acquired migration lock`),
    onLockReleased: () => console.log(`[replica ${replica}] released migration lock`),
  });

  await coordinator.migrate();
}
