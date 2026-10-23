import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { MssqlAppLock, TediousDriver } from '@nodejs-db-migration-lock/mssql';

class MssqlSchemaRunner implements MigrationRunner {
  constructor(private readonly db: TediousDriver) {}

  async run(): Promise<void> {
    await this.db.query(`
      IF OBJECT_ID('dbo.users', 'U') IS NULL
      CREATE TABLE dbo.users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        email NVARCHAR(255) NOT NULL UNIQUE
      )
    `);
  }
}

export async function runLockedMigrations(db: TediousDriver): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';

  const coordinator = new MigrationCoordinator({
    driver: db,
    lockProvider: new MssqlAppLock(),
    migrationRunner: new MssqlSchemaRunner(db),
    retryConfig: { maxRetries: 60, retryIntervalMs: 1000, timeoutMs: 120000 },
    onLockWaiting: (attempt, max) =>
      console.log(`[replica ${replica}] waiting for migration lock (${attempt}/${max})`),
    onLockAcquired: () => console.log(`[replica ${replica}] acquired migration lock`),
    onLockReleased: () => console.log(`[replica ${replica}] released migration lock`),
  });

  await coordinator.migrate();
}
