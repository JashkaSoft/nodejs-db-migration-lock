/**
 * Example: Extending the library for MySQL
 * 
 * This shows how you can create your own database-specific lock provider
 * and driver adapter for databases not yet officially supported.
 */

import { 
  SqlDriver, 
  LockProvider, 
  MigrationCoordinator,
  MigrationRunner 
} from '@nodejs-db-migration-lock/core';
import type { QueryValues } from 'mysql2';
import type { Pool, PoolConnection } from 'mysql2/promise';

/**
 * MySQL Driver Adapter
 * Adapts mysql2 Pool to work with SqlDriver interface
 */
class MySQLDriver implements SqlDriver {
  private active: Pool | PoolConnection;

  constructor(private pool: Pool) {
    this.active = pool;
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const [rows] = await this.active.query(sql, params as QueryValues | undefined);
    return rows as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();
    const previous = this.active;
    this.active = connection;

    try {
      const result = await fn();
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      this.active = previous;
      connection.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * MySQL Table-Based Lock Provider
 * Uses GET_LOCK() for advisory locking
 */
class MySQLAdvisoryLock implements LockProvider {
  name = 'mysql-advisory-lock';
  
  constructor(
    private lockName: string = 'migration_lock',
    private timeoutSeconds: number = 0,
  ) {}

  async acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;

    // MySQL GET_LOCK returns 1 if successful, 0 if timeout, NULL if error
    const result = await driver.query<{ lock_result: number | null }>(
      'SELECT GET_LOCK(?, ?) as lock_result',
      [this.lockName, this.timeoutSeconds],
    );
    
    return result[0]?.lock_result === 1;
  }

  async release(driver: SqlDriver): Promise<void> {
    await driver.query('SELECT RELEASE_LOCK(?)', [this.lockName]);
  }

  async healthcheck(driver: SqlDriver): Promise<boolean> {
    try {
      await driver.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * MySQL Table-Based Lock (Alternative strategy)
 * Similar to PostgreSQL table-based locks
 */
class MySQLTableLock implements LockProvider {
  name = 'mysql-table-lock';
  
  constructor(
    private tableName: string = 'migration_lock',
    private lockId: number = 1,
  ) {}

  async ensureInfrastructure(driver: SqlDriver): Promise<void> {
    // Create lock table if it doesn't exist
    await driver.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id INT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return false;

    try {
      // Try to insert the lock row
      await driver.query(
        `INSERT INTO ${this.tableName} (id) VALUES (?)`,
        [this.lockId],
      );
      return true;
    } catch (error: unknown) {
      // Duplicate entry error means lock is held
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        return false;
      }
      throw error;
    }
  }

  async release(driver: SqlDriver): Promise<void> {
    await driver.query(
      `DELETE FROM ${this.tableName} WHERE id = ?`,
      [this.lockId],
    );
  }
}

/**
 * Example usage
 */
async function example() {
  // Note: This is pseudo-code, mysql2 would need to be installed
  const mysql = require('mysql2/promise');
  
  const pool = await mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'mydb',
  });

  const driver = new MySQLDriver(pool);
  const lockProvider = new MySQLAdvisoryLock('my_migration_lock');
  
  class MyMigrationRunner implements MigrationRunner {
    async run(): Promise<void> {
      console.log('Running MySQL migrations...');
      // Your migration logic here
    }
  }

  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider,
    migrationRunner: new MyMigrationRunner(),
  });

  await coordinator.migrate();
  await driver.close();
}

/**
 * This example demonstrates:
 * 
 * 1. Creating a custom SqlDriver for a different database (MySQL)
 * 2. Implementing different lock strategies (advisory vs table-based)
 * 3. How the core library is database-agnostic
 * 4. The pattern for creating new database-specific packages
 * 
 * You can follow this pattern to add support for:
 * - MySQL / MariaDB
 * - SQLite
 * - Microsoft SQL Server
 * - Oracle
 * - Any other SQL database
 */

export {
  MySQLDriver,
  MySQLAdvisoryLock,
  MySQLTableLock,
};

