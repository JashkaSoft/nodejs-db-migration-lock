/**
 * Complete example using TypeORM with table-based locks
 */

import { DataSource } from 'typeorm';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';
import { TypeORMDriver } from '@nodejs-db-migration-lock/typeorm';

class TypeORMMigrationRunner implements MigrationRunner {
  constructor(private readonly dataSource: DataSource) {}

  async run(): Promise<void> {
    console.log('🚀 Running migrations...');
    await this.dataSource.runMigrations({ transaction: 'all' });
    console.log('✅ Migrations completed successfully');
  }
}

function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'myapp',
    entities: [],
    migrations: ['./migrations/*.ts'],
    synchronize: false,
  });
}

async function runMigrations(): Promise<void> {
  const dataSource = createDataSource();

  console.log('🔌 Connecting to database...');
  await dataSource.initialize();
  console.log('✅ Database connected');

  const driver = new TypeORMDriver(dataSource);
  const lockProvider = new PostgresTableLock({
    tableName: 'migration_lock',
    lockId: 1,
  });

  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider,
    migrationRunner: new TypeORMMigrationRunner(dataSource),
    retryConfig: {
      maxRetries: 60,
      retryIntervalMs: 2000,
      timeoutMs: 120000,
    },
    onLockWaiting: (attempt, maxRetries) => {
      console.log(`⏳ Lock is held by another process, retrying... (${attempt}/${maxRetries})`);
    },
    onLockAcquired: () => {
      console.log('🔒 Migration lock acquired');
    },
    onLockReleased: () => {
      console.log('🔓 Migration lock released');
    },
    onMigrationStart: () => {
      console.log('📦 Starting migration execution...');
    },
    onMigrationComplete: () => {
      console.log('✅ Migration execution completed');
    },
  });

  try {
    await coordinator.migrate();
    console.log('✅ All done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

process.on('SIGINT', () => {
  console.log('\n⚠️  Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⚠️  Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

runMigrations().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
