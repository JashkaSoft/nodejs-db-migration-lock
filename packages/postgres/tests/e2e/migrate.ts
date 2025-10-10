/**
 * E2E Migration Test Script
 * This script simulates a real migration process that multiple containers will run concurrently
 */

import { Pool } from 'pg';
import {
  MigrationCoordinator,
  MigrationRunner,
  LockTimeoutError,
} from '@nodejs-db-migration-lock/core';
import {
  NodePgDriver,
  PostgresTableLock,
  PostgresAdvisoryLock,
} from '@nodejs-db-migration-lock/postgres';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';
const LOCK_STRATEGY = process.env.LOCK_STRATEGY || 'table';

interface MigrationLog {
  process_id: string;
  started_at: Date;
  completed_at: Date | null;
  status: 'started' | 'completed' | 'failed';
  lock_strategy: string;
  error_message?: string;
}

/**
 * Database configuration from environment
 */
const dbConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'testuser',
  password: process.env.POSTGRES_PASSWORD || 'testpass',
  database: process.env.POSTGRES_DB || 'migration_test',
};

/**
 * Migration runner that performs actual database migrations
 */
class TestMigrationRunner implements MigrationRunner {
  constructor(private pool: Pool, private processId: string) {}

  async run(): Promise<void> {
    console.log(`[Process ${this.processId}] Executing migrations...`);

    // Create test tables (simulating real migrations)
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by VARCHAR(50)
      );
    `);

    console.log(`[Process ${this.processId}] Created users table`);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by VARCHAR(50)
      );
    `);

    console.log(`[Process ${this.processId}] Created posts table`);

    // Create indexes
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `);

    console.log(`[Process ${this.processId}] Created indexes`);

    // Insert a record to track which process ran the migration
    await this.pool.query(
      `INSERT INTO users (email, name, created_by) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (email) DO NOTHING`,
      [
        `process-${this.processId}@test.com`,
        `Process ${this.processId}`,
        this.processId,
      ],
    );

    console.log(`[Process ${this.processId}] Inserted tracking record`);

    // Simulate migration time
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(`[Process ${this.processId}] ✅ Migration completed successfully`);
  }
}

/**
 * Log migration attempt to database
 */
async function logMigrationAttempt(
  pool: Pool,
  log: Partial<MigrationLog>,
): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_logs (
      id SERIAL PRIMARY KEY,
      process_id VARCHAR(50),
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      status VARCHAR(20),
      lock_strategy VARCHAR(50),
      error_message TEXT
    );
  `);

  await pool.query(
    `INSERT INTO migration_logs (process_id, started_at, completed_at, status, lock_strategy, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      log.process_id,
      log.started_at,
      log.completed_at,
      log.status,
      log.lock_strategy,
      log.error_message,
    ],
  );
}

/**
 * Main migration function
 */
async function runMigration(): Promise<void> {
  console.log(`[Process ${PROCESS_ID}] Starting migration process`);
  console.log(`[Process ${PROCESS_ID}] Lock strategy: ${LOCK_STRATEGY}`);
  console.log(`[Process ${PROCESS_ID}] Database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

  const pool = new Pool(dbConfig);

  let lockAcquiredTime: Date | null = null;

  try {
    // Test connection
    await pool.query('SELECT 1');
    console.log(`[Process ${PROCESS_ID}] Database connection established`);

    // Create driver
    const driver = new NodePgDriver(pool);

    // Choose lock provider based on strategy
    const lockProvider =
      LOCK_STRATEGY === 'advisory'
        ? new PostgresAdvisoryLock({ lockId: 999999 })
        : new PostgresTableLock({
            tableName: 'migration_lock',
            lockId: 1,
          });

    // Create migration runner
    const migrationRunner = new TestMigrationRunner(pool, PROCESS_ID);

    // Create coordinator
    const coordinator = new MigrationCoordinator({
      driver,
      lockProvider,
      migrationRunner,
      retryConfig: {
        maxRetries: 30,
        retryIntervalMs: 1000,
      },
      onLockWaiting: (attempt, maxRetries) => {
        console.log(
          `[Process ${PROCESS_ID}] ⏳ Waiting for lock... (${attempt}/${maxRetries})`,
        );
      },
      onLockAcquired: () => {
        lockAcquiredTime = new Date();
        console.log(`[Process ${PROCESS_ID}] 🔒 Lock acquired`);
      },
      onLockReleased: () => {
        console.log(`[Process ${PROCESS_ID}] 🔓 Lock released`);
      },
      onMigrationStart: () => {
        console.log(`[Process ${PROCESS_ID}] 🚀 Migration started`);
      },
      onMigrationComplete: () => {
        console.log(`[Process ${PROCESS_ID}] ✅ Migration completed`);
      },
    });

    // Run migration
    await coordinator.migrate();

    // Log success
    await logMigrationAttempt(pool, {
      process_id: PROCESS_ID,
      started_at: lockAcquiredTime || new Date(),
      completed_at: new Date(),
      status: 'completed',
      lock_strategy: LOCK_STRATEGY,
    });

    console.log(`[Process ${PROCESS_ID}] ✅ Migration process completed successfully`);

    process.exit(0)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    console.error(`[Process ${PROCESS_ID}] ❌ Migration failed:`, errorMessage);

    // Log failure
    try {
      await logMigrationAttempt(pool, {
        process_id: PROCESS_ID,
        started_at: lockAcquiredTime || new Date(),
        completed_at: new Date(),
        status: 'failed',
        lock_strategy: LOCK_STRATEGY,
        error_message: errorMessage,
      });
    } catch (logError) {
      console.error(`[Process ${PROCESS_ID}] Failed to log error:`, logError);
    }

    if (error instanceof LockTimeoutError) {
      console.error(
        `[Process ${PROCESS_ID}] Lock timeout after ${error.retries} retries`,
      );
    }
  }
}

// Run migration
runMigration().catch((error) => {
  console.error(`[Process ${PROCESS_ID}] Fatal error:`, error);
  process.exit(1);
});

