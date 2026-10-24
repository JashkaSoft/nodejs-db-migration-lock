import path from 'node:path';
import type { Knex } from 'knex';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { KnexDriver } from '@nodejs-db-migration-lock/knex';
import { MySQLTableLock } from '@nodejs-db-migration-lock/mysql';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

class KnexMigrationRunner implements MigrationRunner {
  constructor(
    private readonly db: Knex,
    private readonly migrationsDirectory: string,
  ) {}

  async run(): Promise<void> {
    await this.db.migrate.latest({
      directory: this.migrationsDirectory,
    });
  }
}

export async function runLockedMigrations(db: Knex): Promise<void> {
  const migrationsDirectory = path.join(__dirname, 'migrations');
  const replica = process.env.REPLICA_ID || 'unknown';
  const dbType = process.env.DB_TYPE || 'postgres';
  const lockProvider = dbType === 'mysql' ? new MySQLTableLock() : new PostgresTableLock();

  const coordinator = new MigrationCoordinator({
    driver: new KnexDriver(db),
    lockProvider,
    migrationRunner: new KnexMigrationRunner(db, migrationsDirectory),
    retryConfig: { maxRetries: 60, retryIntervalMs: 1000 },
    onLockWaiting: (attempt, max) =>
      console.log(`[replica ${replica}] waiting for migration lock (${attempt}/${max})`),
    onLockAcquired: () => console.log(`[replica ${replica}] acquired migration lock`),
    onLockReleased: () => console.log(`[replica ${replica}] released migration lock`),
  });

  await coordinator.migrate();
}
