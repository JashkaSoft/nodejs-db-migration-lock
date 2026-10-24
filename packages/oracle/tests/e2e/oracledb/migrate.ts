import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { OracleAppLock, OracleDriver } from '@nodejs-db-migration-lock/oracle';

const PROCESS_ID = process.env.PROCESS_ID || 'unknown';

function driver(): OracleDriver {
  const host = process.env.ORACLE_HOST || 'localhost';
  const port = process.env.ORACLE_PORT || '1521';
  const service = process.env.ORACLE_SERVICE || 'FREEPDB1';
  return new OracleDriver({
    user: process.env.ORACLE_USER || 'system',
    password: process.env.ORACLE_PASSWORD || 'Migration_Lock_1',
    connectString: `${host}:${port}/${service}`,
  });
}

async function ensure(db: OracleDriver, sql: string): Promise<void> {
  await db.query(`
    BEGIN
      EXECUTE IMMEDIATE '${sql.replace(/'/g, "''")}';
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE != -955 THEN
          RAISE;
        END IF;
    END;
  `);
}

class Runner implements MigrationRunner {
  constructor(private readonly db: OracleDriver, private readonly processId: string) {}

  async run(): Promise<void> {
    await ensure(this.db, `
      CREATE TABLE users (
        email VARCHAR2(255) PRIMARY KEY,
        created_by VARCHAR2(50) NOT NULL
      )
    `);
    await ensure(this.db, `
      CREATE TABLE posts (
        title VARCHAR2(255) PRIMARY KEY
      )
    `);
    await this.db.query(
      `INSERT INTO posts (title) SELECT :p1 FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM posts WHERE title = :p2)`,
      ['hello', 'hello'],
    );
    await this.db.query(
      `INSERT INTO users (email, created_by) SELECT :p1, :p2 FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = :p3)`,
      [`process-${this.processId}@test.com`, this.processId, `process-${this.processId}@test.com`],
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function logAttempt(db: OracleDriver, status: string, started: Date, error?: string): Promise<void> {
  await ensure(db, `
    CREATE TABLE migration_logs (
      process_id VARCHAR2(50) PRIMARY KEY,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      status VARCHAR2(20),
      error_message VARCHAR2(4000)
    )
  `);
  await db.query(
    `MERGE INTO migration_logs t
     USING (SELECT :p1 AS process_id FROM DUAL) s
     ON (t.process_id = s.process_id)
     WHEN MATCHED THEN UPDATE SET completed_at = :p2, status = :p3, error_message = :p4
     WHEN NOT MATCHED THEN INSERT (process_id, started_at, completed_at, status, error_message)
       VALUES (:p5, :p6, :p7, :p8, :p9)`,
    [
      PROCESS_ID,
      started,
      status,
      error ?? null,
      PROCESS_ID,
      started,
      started,
      status,
      error ?? null,
    ],
  );
}

async function main(): Promise<void> {
  const db = driver();
  let started = new Date();
  try {
    const coordinator = new MigrationCoordinator({
      driver: db,
      lockProvider: new OracleAppLock(),
      migrationRunner: new Runner(db, PROCESS_ID),
      retryConfig: { maxRetries: 30, retryIntervalMs: 1000, timeoutMs: 180000 },
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
    console.error(`[Process ${PROCESS_ID}] Migration failed:`, error);
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
