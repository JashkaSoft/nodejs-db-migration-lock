/**
 * Advisory lock for a migration that takes many minutes.
 * The lock stays until the session disconnects. Other replicas wait up to timeoutMs.
 *
 * A table lock instead: PostgresTableLock / MySQLTableLock / SqliteTableLock with
 * leaseMs longer than one statement, and renewIntervalMs under half of that lease.
 * Waiters then need maxRetries * retryIntervalMs above the whole run.
 */

import { Pool } from 'pg';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { NodePgDriver, PostgresAdvisoryLock } from '@nodejs-db-migration-lock/postgres';

class ManyMigrations implements MigrationRunner {
  constructor(private readonly pool: Pool) {}

  async run(): Promise<void> {
    const client = await this.pool.connect();
    try {
      for (let version = 1; version <= 50; version += 1) {
        await client.query(
          `CREATE TABLE IF NOT EXISTS migration_${version} (id int primary key)`,
        );
      }
    } finally {
      client.release();
    }
  }
}

async function main(): Promise<void> {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'myapp',
    max: 10,
  });
  const driver = new NodePgDriver(pool);

  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider: new PostgresAdvisoryLock(),
    migrationRunner: new ManyMigrations(pool),
    retryConfig: { timeoutMs: 30 * 60 * 1000 },
    onLockWaiting: () => console.log('waiting for the advisory lock'),
    onLockAcquired: () => console.log('advisory lock acquired'),
    onLockReleased: () => console.log('advisory lock released'),
  });

  try {
    await coordinator.migrate();
  } finally {
    await driver.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
