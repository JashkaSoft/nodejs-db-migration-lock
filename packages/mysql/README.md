# @nodejs-db-migration-lock/mysql

MySQL/MariaDB adapter with `GET_LOCK()` advisory locks and table-based locks.

Pull-request end-to-end tests run the mysql2 suite on Node 26 against MySQL 9.7, MySQL 8.4, MariaDB 11.8, and MariaDB 10.11 (`MYSQL_IMAGE`).

## Installation

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/mysql
npm install mysql2
# TypeORM
npm install @nodejs-db-migration-lock/typeorm typeorm mysql2
# Sequelize
npm install @nodejs-db-migration-lock/sequelize sequelize mysql2
# Knex
npm install @nodejs-db-migration-lock/knex knex mysql2
```

## Lock strategies

**Advisory (`GET_LOCK`)** — session-level, no extra table. Use `Mysql2Driver` (or TypeORM/Sequelize/Knex adapters with a pinned connection).

**Table lock** — `INSERT IGNORE` into a one-row lock table. Survives reconnects until released.

On first use the table lock creates `migration_lock` (or `tableName`) with `holder`, `locked_at`, and `expires_at`. That needs `CREATE` on the database unless an admin pre-creates the table. Omit `lockName` and `GET_LOCK` uses `nodejs_db_migration_lock:<database>`, because MySQL named locks are server-wide.

## Usage

```typescript
import mysql from 'mysql2/promise';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { Mysql2Driver, MySQLTableLock } from '@nodejs-db-migration-lock/mysql';

class MyMigrationRunner implements MigrationRunner {
  constructor(private readonly pool: mysql.Pool) {}

  async run(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

const pool = mysql.createPool({ /* config */ });
const coordinator = new MigrationCoordinator({
  driver: new Mysql2Driver(pool),
  lockProvider: new MySQLTableLock(),
  migrationRunner: new MyMigrationRunner(pool),
});
await coordinator.migrate();
```

## Release the lock by hand

`MySQLAdvisoryLock` has no `forceRelease`. On the session that acquired it, the default name is `nodejs_db_migration_lock:<database>`:

```sql
SELECT RELEASE_LOCK('nodejs_db_migration_lock:<database>');
```

`GET_LOCK` is server-wide and limited to 64 bytes. If this process is gone but the session is still up, `KILL` that connection.

`MySQLTableLock` uses `forceRelease(driver)`:

```sql
DELETE FROM migration_lock WHERE id = 1;
```

`release(driver)` also matches `holder`. The next waiter takes the row after `expires_at`.
