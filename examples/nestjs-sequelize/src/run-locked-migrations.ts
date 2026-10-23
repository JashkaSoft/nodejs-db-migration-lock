import { Sequelize } from 'sequelize';
import { Umzug, SequelizeStorage } from 'umzug';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';
import { MySQLTableLock } from '@nodejs-db-migration-lock/mysql';
import { SequelizeDriver } from './sequelize-driver';

class SequelizeUmzugRunner implements MigrationRunner {
  constructor(private readonly sequelize: Sequelize) {}

  async run(): Promise<void> {
    const umzug = new Umzug({
      migrations: {
        glob: ['migrations/*.js', { cwd: __dirname }],
      },
      context: this.sequelize.getQueryInterface(),
      storage: new SequelizeStorage({ sequelize: this.sequelize }),
      logger: console,
    });
    await umzug.up();
  }
}

export async function runLockedMigrations(sequelize: Sequelize): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';
  const dbType = process.env.DB_TYPE || 'postgres';
  const lockProvider = dbType === 'mysql' ? new MySQLTableLock() : new PostgresTableLock();

  const coordinator = new MigrationCoordinator({
    driver: new SequelizeDriver(sequelize),
    lockProvider,
    migrationRunner: new SequelizeUmzugRunner(sequelize),
    retryConfig: { maxRetries: 60, retryIntervalMs: 1000 },
    onLockWaiting: (attempt, max) =>
      console.log(`[replica ${replica}] waiting for migration lock (${attempt}/${max})`),
    onLockAcquired: () => console.log(`[replica ${replica}] acquired migration lock`),
    onLockReleased: () => console.log(`[replica ${replica}] released migration lock`),
  });

  await coordinator.migrate();
}
