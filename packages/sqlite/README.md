# @nodejs-db-migration-lock/sqlite

SQLite adapter: `SqliteTableLock` plus `NodeSqliteDriver` for Node's built-in `node:sqlite`.

SQLite has no session advisory lock. Concurrent processes sharing one file should use the table lock. The driver turns on WAL and a busy timeout so writers wait instead of failing immediately.

## Installation

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/sqlite
```

Requires Node.js 24.15+ (`node:sqlite`).

## Usage

```typescript
import { DatabaseSync } from 'node:sqlite';
import { MigrationCoordinator } from '@nodejs-db-migration-lock/core';
import { NodeSqliteDriver, SqliteTableLock } from '@nodejs-db-migration-lock/sqlite';

const db = new DatabaseSync(process.env.SQLITE_PATH || './app.db', { timeout: 5000 });

const coordinator = new MigrationCoordinator({
  driver: new NodeSqliteDriver(db),
  lockProvider: new SqliteTableLock(),
  migrationRunner,
});
await coordinator.migrate();
```

On first use the table lock creates `migration_lock` (or `tableName`) with `holder`, `locked_at`, and `expires_at`. Pair TypeORM/Sequelize/Knex with this lock package the same way as postgres/mysql.

```bash
npm run test:e2e:sqlite:node-sqlite
```
