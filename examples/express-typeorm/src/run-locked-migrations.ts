import { DataSource } from 'typeorm';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import {
  PostgresTableLock,
  TypeORMDriver as PostgresTypeOrmDriver,
} from '@nodejs-db-migration-lock/postgres';
import {
  MySQLTableLock,
  TypeORMDriver as MysqlTypeOrmDriver,
} from '@nodejs-db-migration-lock/mysql';

class TypeOrmRunner implements MigrationRunner {
  constructor(private readonly dataSource: DataSource) {}
  async run(): Promise<void> {
    await this.dataSource.runMigrations({ transaction: 'all' });
  }
}

export async function runLockedMigrations(dataSource: DataSource): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';
  const dbType = process.env.DB_TYPE || 'postgres';
  const driver =
    dbType === 'mysql'
      ? new MysqlTypeOrmDriver(dataSource)
      : new PostgresTypeOrmDriver(dataSource);
  const lockProvider = dbType === 'mysql' ? new MySQLTableLock() : new PostgresTableLock();

  const coordinator = new MigrationCoordinator({
    driver,
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
