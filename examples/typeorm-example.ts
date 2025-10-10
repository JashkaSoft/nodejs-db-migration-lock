/**
 * Complete example using TypeORM with table-based locks
 */

import { DataSource } from 'typeorm';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { 
  TypeORMDriver, 
  PostgresTableLock 
} from '@nodejs-db-migration-lock/postgres';

// Configure your TypeORM DataSource
const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'myapp',
  // Add your entities and migrations
  entities: [],
  migrations: ['./migrations/*.ts'],
  synchronize: false,
});

// Implement the migration runner
class TypeORMMigrationRunner implements MigrationRunner {
  constructor(private dataSource: DataSource) {}

  async run(): Promise<void> {
    console.log('🚀 Running migrations...');
    await this.dataSource.runMigrations({ transaction: 'all' });
    console.log('✅ Migrations completed successfully');
  }
}

// Main migration function
async function runMigrations() {
  console.log('🔌 Connecting to database...');
  await AppDataSource.initialize();
  console.log('✅ Database connected');

  // Create the driver adapter
  const driver = new TypeORMDriver(AppDataSource);

  // Choose lock strategy (table-based for robustness)
  const lockProvider = new PostgresTableLock({
    tableName: 'migration_lock',
    lockId: 1,
  });

  // Create migration coordinator
  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider,
    migrationRunner: new TypeORMMigrationRunner(AppDataSource),
    retryConfig: {
      maxRetries: 60,        // 60 attempts
      retryIntervalMs: 2000, // 2 seconds between attempts
      timeoutMs: 120000,     // 2 minute total timeout
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
    await AppDataSource.destroy();
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⚠️  Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Run migrations
runMigrations().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

