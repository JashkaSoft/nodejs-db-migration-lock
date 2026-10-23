# @nodejs-db-migration-lock/mysql

MySQL/MariaDB adapter with `GET_LOCK()` advisory locks and table-based locks.

Pull-request end-to-end tests use MySQL 9.7. MySQL 8.4 and MariaDB 11.8 run the same mysql2 suite on `main` and weekly (`MYSQL_IMAGE`).

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
import { MigrationCoordinator } from '@nodejs-db-migration-lock/core';
import { Mysql2Driver, MySQLTableLock } from '@nodejs-db-migration-lock/mysql';

const pool = mysql.createPool({ /* config */ });
const coordinator = new MigrationCoordinator({
  driver: new Mysql2Driver(pool),
  lockProvider: new MySQLTableLock(),
  migrationRunner,
});
await coordinator.migrate();
```
