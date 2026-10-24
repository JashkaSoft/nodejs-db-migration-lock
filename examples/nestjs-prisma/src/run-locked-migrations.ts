import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { NodePgDriver, PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

const execFileAsync = promisify(execFile);
const exampleRoot = fileURLToPath(new URL('..', import.meta.url));

class PrismaMigrateRunner implements MigrationRunner {
  async run(): Promise<void> {
    const prisma = path.join(exampleRoot, 'node_modules', '.bin', 'prisma');
    await execFileAsync(prisma, ['migrate', 'deploy'], {
      cwd: exampleRoot,
      env: process.env,
    });
    // Hold the lease long enough for the other replicas to log a wait.
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export async function runLockedMigrations(connectionString: string): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';
  // Prisma Migrate refuses a non-empty public schema that has no migration
  // history. The lease table is created before migrate deploy, so keep it
  // out of public.
  const bootstrap = new Pool({ connectionString });
  await bootstrap.query('CREATE SCHEMA IF NOT EXISTS migration_lock');
  await bootstrap.end();

  const pool = new Pool({
    connectionString,
    options: '-c search_path=migration_lock',
  });
  const driver = new NodePgDriver(pool);

  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider: new PostgresTableLock(),
    migrationRunner: new PrismaMigrateRunner(),
    retryConfig: { maxRetries: 60, retryIntervalMs: 1000 },
    onLockWaiting: (attempt, max) =>
      console.log(`[replica ${replica}] waiting for migration lock (${attempt}/${max})`),
    onLockAcquired: () => console.log(`[replica ${replica}] acquired migration lock`),
    onLockReleased: () => console.log(`[replica ${replica}] released migration lock`),
  });

  try {
    await coordinator.migrate();
  } finally {
    await driver.close();
  }
}
