import { CompiledQuery, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { KyselyDriver } from '@nodejs-db-migration-lock/kysely';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';

function env(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function database(): Kysely<any> {
  return new Kysely({
    dialect: new PostgresDialect({
      pool: new Pool({
        host: env('POSTGRES_HOST', 'localhost'),
        port: parseInt(env('POSTGRES_PORT', '5432'), 10),
        user: env('POSTGRES_USER', 'testuser'),
        password: env('POSTGRES_PASSWORD', 'testpass'),
        database: env('POSTGRES_DB', 'migration_test'),
        max: 4,
      }),
    }),
  });
}

async function sql(db: Kysely<any>, text: string, params?: unknown[]): Promise<void> {
  await db.executeQuery(CompiledQuery.raw(text, params ?? []));
}

class Runner implements MigrationRunner {
  constructor(private readonly db: Kysely<any>, private readonly processId: string) {}

  async run(): Promise<void> {
    await sql(this.db, `
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by VARCHAR(50)
      )
    `);
    await sql(this.db, `
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by VARCHAR(50)
      )
    `);
    await sql(this.db, 'CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id)');
    await sql(this.db, 'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await sql(
      this.db,
      'INSERT INTO users (email, name, created_by) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING',
      [`process-${this.processId}@test.com`, `Process ${this.processId}`, this.processId],
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function logAttempt(db: Kysely<any>, started: Date, status: string, error?: string): Promise<void> {
  await sql(db, `
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
  await sql(
    db,
    `INSERT INTO migration_logs (process_id, started_at, completed_at, status, lock_strategy, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [PROCESS_ID, started, new Date(), status, 'table', error ?? null],
  );
}

async function main(): Promise<void> {
  const db = database();
  const driver = new KyselyDriver(db);
  let started = new Date();
  try {
    const coordinator = new MigrationCoordinator({
      driver,
      lockProvider: new PostgresTableLock(),
      migrationRunner: new Runner(db, PROCESS_ID),
      retryConfig: { maxRetries: 30, retryIntervalMs: 1000, timeoutMs: 120000 },
      onLockAcquired: () => {
        started = new Date();
        console.log(`[Process ${PROCESS_ID}] Lock acquired`);
      },
      onLockWaiting: (attempt, max) =>
        console.log(`[Process ${PROCESS_ID}] Waiting for lock... (${attempt}/${max})`),
    });
    await coordinator.migrate();
    await logAttempt(db, started, 'completed');
    console.log(`[Process ${PROCESS_ID}] Migration process completed successfully`);
  } catch (error) {
    process.exitCode = 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Process ${PROCESS_ID}] Migration failed:`, message);
    try {
      await logAttempt(db, started, 'failed', message);
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
