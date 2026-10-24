import { MikroORM } from '@mikro-orm/postgresql';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { MikroORMDriver } from '@nodejs-db-migration-lock/mikroorm';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';

function env(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

class Runner implements MigrationRunner {
  constructor(private readonly orm: MikroORM, private readonly processId: string) {}

  async run(): Promise<void> {
    const connection = this.orm.em.getConnection();
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by VARCHAR(50)
      )
    `);
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by VARCHAR(50)
      )
    `);
    await connection.execute('CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)');
    await connection.execute('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await connection.execute(
      'INSERT INTO users (email, name, created_by) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING',
      [`process-${this.processId}@test.com`, `Process ${this.processId}`, this.processId],
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function logAttempt(orm: MikroORM, started: Date, status: string, error?: string): Promise<void> {
  const connection = orm.em.getConnection();
  await connection.execute(`
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
  await connection.execute(
    `INSERT INTO migration_logs (process_id, started_at, completed_at, status, lock_strategy, error_message)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [PROCESS_ID, started, new Date(), status, 'table', error ?? null],
  );
}

async function main(): Promise<void> {
  const orm = await MikroORM.init({
    host: env('POSTGRES_HOST', 'localhost'),
    port: parseInt(env('POSTGRES_PORT', '5432'), 10),
    user: env('POSTGRES_USER', 'testuser'),
    password: env('POSTGRES_PASSWORD', 'testpass'),
    dbName: env('POSTGRES_DB', 'migration_test'),
    entities: [],
    discovery: { warnWhenNoEntities: false },
    allowGlobalContext: true,
    ensureDatabase: false,
  });
  const driver = new MikroORMDriver(orm);
  let started = new Date();
  try {
    const coordinator = new MigrationCoordinator({
      driver,
      lockProvider: new PostgresTableLock(),
      migrationRunner: new Runner(orm, PROCESS_ID),
      retryConfig: { maxRetries: 30, retryIntervalMs: 1000, timeoutMs: 120000 },
      onLockAcquired: () => {
        started = new Date();
        console.log(`[Process ${PROCESS_ID}] Lock acquired`);
      },
      onLockWaiting: (attempt, max) =>
        console.log(`[Process ${PROCESS_ID}] Waiting for lock... (${attempt}/${max})`),
    });
    await coordinator.migrate();
    await logAttempt(orm, started, 'completed');
    console.log(`[Process ${PROCESS_ID}] Migration process completed successfully`);
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Process ${PROCESS_ID}] Migration failed:`, error);
    try {
      await logAttempt(orm, started, 'failed', message);
    } catch {
      // The verifier reports a missing log.
    }
  } finally {
    await driver.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
