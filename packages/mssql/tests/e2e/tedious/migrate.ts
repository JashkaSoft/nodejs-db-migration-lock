import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { MssqlAppLock, TediousDriver } from '@nodejs-db-migration-lock/mssql';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';

function driver(): TediousDriver {
  return new TediousDriver({
    server: process.env.MSSQL_HOST || 'localhost',
    authentication: {
      type: 'default',
      options: {
        userName: process.env.MSSQL_USER || 'sa',
        password: process.env.MSSQL_PASSWORD || 'Migration_Lock_1',
      },
    },
    options: {
      database: process.env.MSSQL_DB || 'master',
      port: parseInt(process.env.MSSQL_PORT || '1433', 10),
      encrypt: true,
      trustServerCertificate: true,
      connectTimeout: 30000,
    },
  });
}

class MssqlTestRunner implements MigrationRunner {
  constructor(private readonly db: TediousDriver, private readonly processId: string) {}

  async run(): Promise<void> {
    await this.db.query(`
      IF OBJECT_ID('dbo.users', 'U') IS NULL
      CREATE TABLE dbo.users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        email NVARCHAR(255) NOT NULL UNIQUE,
        name NVARCHAR(255) NOT NULL,
        created_by NVARCHAR(50) NULL
      )
    `);
    await this.db.query(`
      IF OBJECT_ID('dbo.posts', 'U') IS NULL
      CREATE TABLE dbo.posts (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NULL,
        title NVARCHAR(255) NOT NULL,
        content NVARCHAR(MAX) NULL,
        created_by NVARCHAR(50) NULL
      )
    `);
    await this.db.query(
      `IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = @p1)
       INSERT INTO dbo.users (email, name, created_by) VALUES (@p1, @p2, @p3)`,
      [`process-${this.processId}@test.com`, `Process ${this.processId}`, this.processId],
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function logAttempt(db: TediousDriver, status: string, started: Date, error?: string): Promise<void> {
  await db.query(`
    IF OBJECT_ID('dbo.migration_logs', 'U') IS NULL
    CREATE TABLE dbo.migration_logs (
      id INT IDENTITY(1,1) PRIMARY KEY,
      process_id NVARCHAR(50),
      started_at DATETIME2,
      completed_at DATETIME2,
      status NVARCHAR(20),
      lock_strategy NVARCHAR(50),
      error_message NVARCHAR(MAX)
    )
  `);
  await db.query(
    `INSERT INTO dbo.migration_logs (process_id, started_at, completed_at, status, lock_strategy, error_message)
     VALUES (@p1, @p2, @p3, @p4, @p5, @p6)`,
    [PROCESS_ID, started, new Date(), status, 'applock', error ?? null],
  );
}

async function runMigration(): Promise<void> {
  const db = driver();
  const started = new Date();
  try {
    const coordinator = new MigrationCoordinator({
      driver: db,
      lockProvider: new MssqlAppLock({ lockName: 'migration_lock' }),
      migrationRunner: new MssqlTestRunner(db, PROCESS_ID),
      retryConfig: { maxRetries: 30, retryIntervalMs: 1000, timeoutMs: 120000 },
      onLockWaiting: (attempt, max) =>
        console.log(`[Process ${PROCESS_ID}] Waiting for lock... (${attempt}/${max})`),
      onLockAcquired: () => console.log(`[Process ${PROCESS_ID}] Lock acquired`),
    });
    await coordinator.migrate();
    await logAttempt(db, 'completed', started);
    console.log(`[Process ${PROCESS_ID}] Migration process completed successfully`);
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Process ${PROCESS_ID}] Migration failed:`, message);
    try {
      await logAttempt(db, 'failed', started, message);
    } catch {
      // The original failure is already recorded on stderr.
    }
  } finally {
    await db.close().catch(() => undefined);
  }
}

runMigration().catch((error) => {
  console.error(error);
  process.exit(1);
});
