import { DataSource } from 'typeorm';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';
import { MySQLTableLock } from '@nodejs-db-migration-lock/mysql';
import { TypeORMDriver } from '@nodejs-db-migration-lock/typeorm';

class TypeOrmRunner implements MigrationRunner {
  constructor(private readonly dataSource: DataSource) {}
  async run(): Promise<void> {
    await this.dataSource.runMigrations({ transaction: 'all' });
  }
}

export async function runLockedMigrations(dataSource: DataSource): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';
  const dbType = process.env.DB_TYPE || 'postgres';
  const lockProvider = dbType === 'mysql' ? new MySQLTableLock() : new PostgresTableLock();

  const coordinator = new MigrationCoordinator({
    driver: new TypeORMDriver(dataSource),
    lockProvider,
    migrationRunner: new TypeOrmRunner(dataSource),
    retryConfig: { maxRetries: 60, retryIntervalMs: 1000 },
    onLockWaiting: (attempt, max) =>
      console.log(`[replica ${replica}] waiting for migration lock (${attempt}/${max})`),
    onLockAcquired: () => console.log(`[replica ${replica}] acquired migration lock`),
    onLockReleased: () => console.log(`[replica ${replica}] released migration lock`),
  });

  await coordinator.migrate();
}
