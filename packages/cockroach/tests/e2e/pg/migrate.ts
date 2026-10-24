import { Pool } from 'pg';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { CockroachDriver, CockroachTableLock } from '@nodejs-db-migration-lock/cockroach';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';

function pool(): Pool {
  return new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '26257', 10),
    user: process.env.PGUSER || 'root',
    database: process.env.PGDATABASE || 'defaultdb',
    max: 4,
  });
}

class Runner implements MigrationRunner {
  constructor(private readonly db: CockroachDriver, private readonly processId: string) {}

  async run(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        created_by TEXT NOT NULL
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS posts (
        title TEXT PRIMARY KEY
      )
    `);
    await this.db.query(
      `INSERT INTO posts (title) VALUES ($1) ON CONFLICT (title) DO NOTHING`,
      ['hello'],
    );
    await this.db.query(
      'INSERT INTO users (email, created_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
      [`process-${this.processId}@test.com`, this.processId],
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function logAttempt(db: CockroachDriver, status: string, started: Date, error?: string): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS migration_logs (
      process_id TEXT PRIMARY KEY,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      status TEXT,
      error_message TEXT
    )
  `);
  await db.query(
    `INSERT INTO migration_logs (process_id, started_at, completed_at, status, error_message)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (process_id) DO UPDATE
       SET completed_at = EXCLUDED.completed_at, status = EXCLUDED.status, error_message = EXCLUDED.error_message`,
    [PROCESS_ID, started.toISOString(), new Date().toISOString(), status, error ?? null],
  );
}

async function main(): Promise<void> {
  const client = pool();
  const db = new CockroachDriver(client);
  let started = new Date();
  try {
    const coordinator = new MigrationCoordinator({
      driver: db,
      lockProvider: new CockroachTableLock({ leaseMs: 30000 }),
      migrationRunner: new Runner(db, PROCESS_ID),
      retryConfig: { maxRetries: 40, retryIntervalMs: 500, timeoutMs: 120000 },
      onLockAcquired: () => {
        started = new Date();
        console.log(`[Process ${PROCESS_ID}] Lock acquired`);
      },
      onLockWaiting: (attempt, max) =>
        console.log(`[Process ${PROCESS_ID}] Waiting for lock... (${attempt}/${max})`),
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
      // The verifier reports a missing log.
    }
  } finally {
    await db.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
