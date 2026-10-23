/**
 * Clear a table-lock row left by a crashed migrator.
 * forceRelease deletes the row. release deletes it only when this process holds it.
 * status shows holder and expiresAt. The next migrate() also takes the row once expiresAt passes.
 *
 * Advisory locks have no forceRelease. PostgresAdvisoryLock, MySQLAdvisoryLock, and
 * MssqlAppLock end when that session disconnects. release(driver) only unlocks the
 * session this driver has open.
 */

import { Pool } from 'pg';
import type { Pool as MysqlPool } from 'mysql2/promise';
import { DatabaseSync } from 'node:sqlite';
import { Mysql2Driver, MySQLTableLock } from '@nodejs-db-migration-lock/mysql';
import { NodePgDriver, PostgresTableLock } from '@nodejs-db-migration-lock/postgres';
import { NodeSqliteDriver, SqliteTableLock } from '@nodejs-db-migration-lock/sqlite';

async function releasePostgres(): Promise<void> {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'myapp',
  });
  const driver = new NodePgDriver(pool);
  const lock = new PostgresTableLock();
  try {
    console.log(await lock.status(driver));
    await lock.forceRelease(driver);
  } finally {
    await driver.close();
  }
}

async function releaseMysql(): Promise<void> {
  const mysql = await import('mysql2/promise');
  const pool: MysqlPool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'myapp',
  });
  const driver = new Mysql2Driver(pool);
  const lock = new MySQLTableLock();
  try {
    console.log(await lock.status(driver));
    await lock.forceRelease(driver);
  } finally {
    await driver.close();
  }
}

async function releaseSqlite(): Promise<void> {
  const db = new DatabaseSync(process.env.SQLITE_PATH || './app.db');
  const driver = new NodeSqliteDriver(db);
  const lock = new SqliteTableLock();
  try {
    console.log(await lock.status(driver));
    await lock.forceRelease(driver);
  } finally {
    await driver.close();
  }
}

const kind = process.env.LOCK_KIND || 'postgres';
const release =
  kind === 'mysql' ? releaseMysql : kind === 'sqlite' ? releaseSqlite : releasePostgres;

release().catch((error) => {
  console.error(error);
  process.exit(1);
});
