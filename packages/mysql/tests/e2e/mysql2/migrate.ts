import mysql from 'mysql2/promise';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { Mysql2Driver, MySQLTableLock } from '@nodejs-db-migration-lock/mysql';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'testuser',
    password: process.env.MYSQL_PASSWORD || 'testpass',
    database: process.env.MYSQL_DB || 'migration_test',
  });
}

class Mysql2Runner implements MigrationRunner {
  constructor(
    private readonly pool: mysql.Pool,
    private readonly processId: string,
  ) {}

  async run(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(50)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(50)
      )
    `);
    await this.pool.query(
      'INSERT IGNORE INTO users (email, name, created_by) VALUES (?, ?, ?)',
      [`process-${this.processId}@test.com`, `Process ${this.processId}`, this.processId],
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function logAttempt(
  pool: mysql.Pool,
  status: string,
  started: Date,
  error?: string,
): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migration_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      process_id VARCHAR(50),
      started_at TIMESTAMP NULL,
      completed_at TIMESTAMP NULL,
      status VARCHAR(20),
      lock_strategy VARCHAR(50),
      error_message TEXT
    )
  `);
  await pool.query(
    `INSERT INTO migration_logs (process_id, started_at, completed_at, status, lock_strategy, error_message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [PROCESS_ID, started, new Date(), status, 'table', error ?? null],
  );
}

async function runMigration(): Promise<void> {
  const pool = createPool();
  const driver = new Mysql2Driver(pool);
  let started = new Date();
  try {
    const coordinator = new MigrationCoordinator({
      driver,
      lockProvider: new MySQLTableLock(),
      migrationRunner: new Mysql2Runner(pool, PROCESS_ID),
      retryConfig: { maxRetries: 30, retryIntervalMs: 1000 },
      onLockAcquired: () => {
        started = new Date();
        console.log(`[Process ${PROCESS_ID}] Lock acquired`);
      },
    });
    await coordinator.migrate();
    await logAttempt(pool, 'completed', started);
  } catch (error) {
    process.exitCode = 1;
    console.error(error);
    await logAttempt(pool, 'failed', started, error instanceof Error ? error.message : String(error)).catch(
      () => undefined,
    );
  } finally {
    await driver.close().catch(() => undefined);
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
