# @nodejs-db-migration-lock/mysql

MySQL/MariaDB adapter with `GET_LOCK()` advisory locks and table-based locks.

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

On first use it creates `migration_lock` (or `tableName`). That needs `CREATE` on the database unless an admin pre-creates the table. `GET_LOCK` advisory locks create no tables.

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
