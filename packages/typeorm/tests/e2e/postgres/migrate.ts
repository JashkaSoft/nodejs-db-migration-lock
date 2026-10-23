import 'reflect-metadata';
import { DataSource } from 'typeorm';
import {
  MigrationCoordinator,
  MigrationRunner,
  LockTimeoutError,
} from '@nodejs-db-migration-lock/core';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';
import { TypeORMDriver } from '@nodejs-db-migration-lock/typeorm';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  username: process.env.POSTGRES_USER || 'testuser',
  password: process.env.POSTGRES_PASSWORD || 'testpass',
  database: process.env.POSTGRES_DB || 'migration_test',
  entities: [],
  migrations: [],
  synchronize: false,
});

class TypeOrmTestRunner implements MigrationRunner {
  constructor(private readonly source: DataSource, private readonly processId: string) {}

  async run(): Promise<void> {
    await this.source.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by VARCHAR(50)
      )
    `);
    await this.source.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by VARCHAR(50)
      )
    `);
    await this.source.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);
    await this.source.query(
      `INSERT INTO users (email, name, created_by) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
      [`process-${this.processId}@test.com`, `Process ${this.processId}`, this.processId],
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function logAttempt(
  source: DataSource,
  log: {
    process_id: string;
    started_at: Date;
    completed_at: Date;
    status: string;
    error_message?: string;
  },
): Promise<void> {
  await source.query(`
    CREATE TABLE IF NOT EXISTS migration_logs (
      id SERIAL PRIMARY KEY,
      process_id VARCHAR(50),
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      status VARCHAR(20),
      lock_strategy VARCHAR(50),
      error_message TEXT
    )
  `);
  await source.query(
    `INSERT INTO migration_logs (process_id, started_at, completed_at, status, lock_strategy, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [log.process_id, log.started_at, log.completed_at, log.status, 'table', log.error_message ?? null],
  );
}

async function runMigration(): Promise<void> {
  await dataSource.initialize();
  const driver = new TypeORMDriver(dataSource);
  let lockAcquiredTime: Date | null = null;

  try {
    const coordinator = new MigrationCoordinator({
      driver,
      lockProvider: new PostgresTableLock({ tableName: 'migration_lock', lockId: 1 }),
      migrationRunner: new TypeOrmTestRunner(dataSource, PROCESS_ID),
      retryConfig: { maxRetries: 30, retryIntervalMs: 1000 },
      onLockWaiting: (attempt, max) =>
        console.log(`[Process ${PROCESS_ID}] Waiting for lock... (${attempt}/${max})`),
      onLockAcquired: () => {
        lockAcquiredTime = new Date();
        console.log(`[Process ${PROCESS_ID}] Lock acquired`);
      },
    });

    await coordinator.migrate();
    await logAttempt(dataSource, {
      process_id: PROCESS_ID,
      started_at: lockAcquiredTime || new Date(),
      completed_at: new Date(),
      status: 'completed',
    });
    console.log(`[Process ${PROCESS_ID}] Migration process completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Process ${PROCESS_ID}] Migration failed:`, errorMessage);
    try {
      await logAttempt(dataSource, {
        process_id: PROCESS_ID,
        started_at: lockAcquiredTime || new Date(),
        completed_at: new Date(),
        status: 'failed',
        error_message: errorMessage,
      });
    } catch {}
    if (error instanceof LockTimeoutError) {
      console.error(`[Process ${PROCESS_ID}] Lock timeout after ${error.retries} retries`);
    }
    process.exitCode = 1;
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy().catch(() => undefined);
    }
  }
}

runMigration().catch((error) => {
  console.error(`[Process ${PROCESS_ID}] Fatal error:`, error);
  process.exit(1);
});
