import { Sequelize } from 'sequelize';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { MySQLTableLock } from '@nodejs-db-migration-lock/mysql';
import { SequelizeDriver } from '@nodejs-db-migration-lock/sequelize';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';

const sequelize = new Sequelize({
  dialect: 'mysql',
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  username: process.env.MYSQL_USER || 'testuser',
  password: process.env.MYSQL_PASSWORD || 'testpass',
  database: process.env.MYSQL_DB || 'migration_test',
  logging: false,
});

class SequelizeMysqlRunner implements MigrationRunner {
  constructor(private readonly db: Sequelize, private readonly processId: string) {}

  async run(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(50)
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by VARCHAR(50),
        CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await this.db.query('CREATE INDEX idx_posts_user_id ON posts(user_id)').catch(() => undefined);
    await this.db.query('CREATE INDEX idx_users_email ON users(email)').catch(() => undefined);
    await this.db.query(
      'INSERT IGNORE INTO users (email, name, created_by) VALUES (?, ?, ?)',
      {
        replacements: [
          `process-${this.processId}@test.com`,
          `Process ${this.processId}`,
          this.processId,
        ],
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function logAttempt(
  db: Sequelize,
  log: {
    process_id: string;
    started_at: Date;
    completed_at: Date;
    status: string;
    error_message?: string;
  },
): Promise<void> {
  await db.query(`
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
  await db.query(
    `INSERT INTO migration_logs (process_id, started_at, completed_at, status, lock_strategy, error_message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    {
      replacements: [
        log.process_id,
        log.started_at,
        log.completed_at,
        log.status,
        'table',
        log.error_message ?? null,
      ],
    },
  );
}

async function runMigration(): Promise<void> {
  await sequelize.authenticate();
  let lockAcquiredTime: Date | null = null;
  try {
    const coordinator = new MigrationCoordinator({
      driver: new SequelizeDriver(sequelize),
      lockProvider: new MySQLTableLock(),
      migrationRunner: new SequelizeMysqlRunner(sequelize, PROCESS_ID),
      retryConfig: { maxRetries: 30, retryIntervalMs: 1000 },
      onLockWaiting: (attempt, max) =>
        console.log(`[Process ${PROCESS_ID}] Waiting for lock... (${attempt}/${max})`),
      onLockAcquired: () => {
        lockAcquiredTime = new Date();
        console.log(`[Process ${PROCESS_ID}] Lock acquired`);
      },
    });
    await coordinator.migrate();
    await logAttempt(sequelize, {
      process_id: PROCESS_ID,
      started_at: lockAcquiredTime || new Date(),
      completed_at: new Date(),
      status: 'completed',
    });
  } catch (error) {
    process.exitCode = 1;
    console.error(`[Process ${PROCESS_ID}] Migration failed:`, error);
    try {
      await logAttempt(sequelize, {
        process_id: PROCESS_ID,
        started_at: lockAcquiredTime || new Date(),
        completed_at: new Date(),
        status: 'failed',
        error_message: error instanceof Error ? error.message : String(error),
      });
    } catch {}
  } finally {
    await sequelize.close().catch(() => undefined);
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
