# nodejs-db-migration-lock

> A database-agnostic migration lock library for Node.js, similar to Liquibase's lock system but designed specifically for Node.js applications.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Packages](#packages)
- [Quick Start](#quick-start)
  - [Install](#install)
  - [Basic Usage with TypeORM](#basic-usage-with-typeorm)
  - [Usage with node-postgres (pg)](#usage-with-node-postgres-pg)
- [Architecture](#architecture)
  - [SqlDriver](#1-sqldriver)
  - [LockProvider](#2-lockprovider)
  - [MigrationRunner](#3-migrationrunner)
- [Documentation](#documentation)
- [Use Cases](#use-cases)
  - [Kubernetes Deployments](#kubernetes-deployments)
  - [Zero-Downtime Deployments](#zero-downtime-deployments)
  - [CI/CD Pipelines](#cicd-pipelines)
- [Lock Strategies](#lock-strategies)
  - [PostgreSQL](#postgresql)
  - [MySQL](#mysql)
  - [SQLite](#sqlite)
  - [SQL Server](#sql-server)
- [Long migrations](#long-migrations)
- [Releasing a stuck lock](#releasing-a-stuck-lock)
- [Development](#development)
- [Contributing](#contributing)
  - [Adding a New Database](#adding-a-new-database)
- [License](#license)
- [Acknowledgments](#acknowledgments)
- [Related Projects](#related-projects)

## 🎯 Overview

`nodejs-db-migration-lock` ensures that only one process runs database migrations at a time in distributed environments. Whether you're deploying to Kubernetes with multiple replicas, running zero-downtime deployments, or have multiple CI/CD pipelines, this library prevents concurrent migration conflicts.

## ✨ Key Features

- 🔒 **Distributed Locking** - Prevent concurrent migrations across multiple processes/containers
- 🎯 **Database Agnostic** - Core library works with any SQL database
- 🔄 **Retry Logic** - Intelligent retry with configurable timeouts
- 🛡️ **Type Safe** - Full TypeScript support
- 📦 **Modular** - Separate packages for different databases
- ⚡ **Multiple Strategies** - Advisory locks, table-based locks, and more
- 🔌 **Framework Agnostic** - Works with TypeORM, Sequelize, Knex, or plain SQL clients

## 📦 Packages

This is a monorepo containing multiple packages:

| Package | Description | Version |
|---------|-------------|---------|
| [@nodejs-db-migration-lock/core](./packages/core) | Core interfaces and coordination logic | 0.1.0 |
| [@nodejs-db-migration-lock/postgres](./packages/postgres) | PostgreSQL adapter with advisory and table locks | 0.1.0 |
| [@nodejs-db-migration-lock/mysql](./packages/mysql) | MySQL/MariaDB adapter (`GET_LOCK` + table lock) | 0.1.0 |
| [@nodejs-db-migration-lock/typeorm](./packages/typeorm) | TypeORM `DataSource` driver (DB-agnostic) | 0.1.0 |
| [@nodejs-db-migration-lock/sequelize](./packages/sequelize) | Sequelize driver (DB-agnostic) | 0.1.0 |
| [@nodejs-db-migration-lock/knex](./packages/knex) | Knex driver (DB-agnostic) | 0.1.0 |
| [@nodejs-db-migration-lock/sqlite](./packages/sqlite) | SQLite table lock + `node:sqlite` driver | 0.1.0 |
| [@nodejs-db-migration-lock/mssql](./packages/mssql) | SQL Server `sp_getapplock` + tedious driver | 0.1.0 |
| [@nodejs-db-migration-lock/oracle](./packages/oracle) | Oracle `DBMS_LOCK` + oracledb driver | 0.1.0 |
| [@nodejs-db-migration-lock/cockroach](./packages/cockroach) | CockroachDB leased table lock + pg driver | 0.1.0 |
| [@nodejs-db-migration-lock/yugabyte](./packages/yugabyte) | YugabyteDB leased table lock + pg driver | 0.1.0 |
| [@nodejs-db-migration-lock/mikroorm](./packages/mikroorm) | MikroORM driver (DB-agnostic) | 0.1.0 |
| [@nodejs-db-migration-lock/kysely](./packages/kysely) | Kysely driver (DB-agnostic) | 0.1.0 |

## 🚀 Quick Start

### Install

```bash
# For PostgreSQL
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/postgres
npm install pg

# For MySQL
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/mysql
npm install mysql2

# TypeORM (any supported database)
npm install @nodejs-db-migration-lock/typeorm typeorm

# Sequelize (any supported database)
npm install @nodejs-db-migration-lock/sequelize sequelize

# Knex (any supported database)
npm install @nodejs-db-migration-lock/knex knex

# SQLite (Node.js built-in node:sqlite)
npm install @nodejs-db-migration-lock/sqlite

# SQL Server
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/mssql
npm install tedious
```

### Basic Usage with TypeORM

```typescript
import { DataSource } from 'typeorm';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { TypeORMDriver } from '@nodejs-db-migration-lock/typeorm';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

// Initialize your database connection
const dataSource = new DataSource({
  type: 'postgres',
  // ... your config
});
await dataSource.initialize();

class TypeORMMigrationRunner implements MigrationRunner {
  constructor(private readonly dataSource: DataSource) {}

  async run(): Promise<void> {
    await this.dataSource.runMigrations({ transaction: 'all' });
  }
}

// Coordinate the migration with locking
const coordinator = new MigrationCoordinator({
  driver: new TypeORMDriver(dataSource),
  lockProvider: new PostgresTableLock(),
  migrationRunner: new TypeORMMigrationRunner(dataSource),
  onLockWaiting: (attempt, max) => 
    console.log(`Waiting for lock... (${attempt}/${max})`),
});

await coordinator.migrate();
```

### Usage with node-postgres (pg)

```typescript
import { Pool } from 'pg';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { NodePgDriver, PostgresAdvisoryLock } from '@nodejs-db-migration-lock/postgres';

const pool = new Pool({ /* config */ });

class PgMigrationRunner implements MigrationRunner {
  constructor(private readonly pool: Pool) {}

  async run(): Promise<void> {
    // Run your SQL migrations (e.g. from files or a migration tool)
    await this.pool.query('SELECT 1');
  }
}

const coordinator = new MigrationCoordinator({
  driver: new NodePgDriver(pool),
  lockProvider: new PostgresAdvisoryLock(),
  migrationRunner: new PgMigrationRunner(pool),
});

await coordinator.migrate();
```

## 🏗️ Architecture

The library is built on three simple interfaces that work together:

### 1. SqlDriver
Abstracts database query execution. You implement this (or use a provided adapter) to connect your database client.

```typescript
interface SqlDriver {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}
```

### 2. LockProvider
Defines how locks are acquired and released. Each database can have multiple strategies (advisory, table-based, etc.).

```typescript
interface LockProvider {
  acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean>;
  release(driver: SqlDriver): Promise<void>;
}
```

### 3. MigrationRunner
Your migration execution logic.

```typescript
interface MigrationRunner {
  run(): Promise<void>;
}
```

The `MigrationCoordinator` orchestrates these three pieces with retry logic, error handling, and lifecycle hooks.

## 📚 Documentation

- [Core Package Documentation](./packages/core/README.md)
- [PostgreSQL Package Documentation](./packages/postgres/README.md)
- [MySQL Package Documentation](./packages/mysql/README.md)
- [TypeORM Package Documentation](./packages/typeorm/README.md)
- [Sequelize Package Documentation](./packages/sequelize/README.md)
- [Knex Package Documentation](./packages/knex/README.md)
- [SQLite Package Documentation](./packages/sqlite/README.md)
- [SQL Server Package Documentation](./packages/mssql/README.md)
- [Oracle Package Documentation](./packages/oracle/README.md)
- [CockroachDB Package Documentation](./packages/cockroach/README.md)
- [YugabyteDB Package Documentation](./packages/yugabyte/README.md)
- [MikroORM Package Documentation](./packages/mikroorm/README.md)
- [Kysely Package Documentation](./packages/kysely/README.md)
- [Examples](./examples)

## 🔍 Use Cases

### Kubernetes Deployments

When deploying to Kubernetes with multiple replicas, all pods might start simultaneously and try to run migrations:

```typescript
// All 3 pods try to run migrations at startup
// Only one will acquire the lock, others will wait
await coordinator.migrate();
```

### Zero-Downtime Deployments

During blue-green or rolling deployments, both old and new versions might be running:

```typescript
// New deployment starts and attempts migration
// If old deployment is still running migrations, new one waits
const coordinator = new MigrationCoordinator({
  // ...
  retryConfig: {
    maxRetries: 60,
    retryIntervalMs: 2000,
  },
});
```

### CI/CD Pipelines

Multiple CI/CD pipelines (staging, production, feature branches) sharing a database:

```typescript
// Each pipeline deployment waits for others to complete
// Prevents corrupted migration state
```

## 🎯 Lock Strategies

### PostgreSQL

**Advisory locks** (session by default; released when the connection closes)
```typescript
new PostgresAdvisoryLock() // key derived from current_database()
new PostgresAdvisoryLock({ lockId: 123456789, scope: 'session', wait: 'database' })
new PostgresAdvisoryLock({ lockId: 123456789, scope: 'transaction' })
```

`wait: 'database'` blocks in `pg_advisory_lock` until `retryConfig.timeoutMs`. `scope: 'transaction'` uses `pg_advisory_xact_lock` and the coordinator holds one transaction across the migration. Session scope is the default because a typical ORM migration opens more than one transaction.

**Table locks** (one-row lease: `holder`, `locked_at`, `expires_at`)
```typescript
new PostgresTableLock({ tableName: 'migration_lock', leaseMs: 30000 })
```

The coordinator renews the lease on a second connection while migrations run, so a long statement on the lock session cannot starve the heartbeat. Only the process that holds the lock checks that connection out, and only until `migrate()` returns. Replicas still waiting keep the one session they pinned to try the lock. Advisory locks do not take this extra connection. `release()` deletes the row only when `holder` matches. `forceRelease()` clears it after a crash if you do not want to wait for `expires_at`. Creates (if missing) `migration_lock`. The DB user needs `CREATE` on the schema (or pre-create the table). An older `id`/`created_at` lock table gets the new columns on startup.

### MySQL

**Advisory (`GET_LOCK`)** — session-scoped and server-wide. The default name is `nodejs_db_migration_lock:<database>`. Pin one connection (`Mysql2Driver`). `GET_LOCK` waits in MySQL for the coordinator timeout.
```typescript
new MySQLAdvisoryLock()
new MySQLAdvisoryLock({ lockName: 'migration_lock', wait: 'database' })
```

Creates no tables.

**Table lock** (one-row lease, same columns as Postgres)
```typescript
new MySQLTableLock({ tableName: 'migration_lock' })
```

A short `GET_LOCK` wraps the row update so two sessions cannot steal an expired lease at once. Creates (if missing) `migration_lock`. The DB user needs `CREATE` on the database (or pre-create the table).

### SQLite

`SqliteTableLock` is the same lease table. SQLite has no advisory lock; the write transaction makes the upsert atomic.

### SQL Server

```typescript
new MssqlAppLock() // sp_getapplock, resource scoped with DB_NAME()
new MssqlAppLock({ lockName: 'migration_lock', scope: 'session' })
```

`TediousDriver` keeps one connection. A session application lock ends when that connection closes. Pass `scope: 'transaction'` only when the migration runs inside that connection's transaction.

ORM drivers (`TypeORMDriver`, `SequelizeDriver`, `KnexDriver`, `MikroORMDriver`, `KyselyDriver`) check out one pool connection for lock SQL. A table lock checks out one more on the holder, for the heartbeat. Size that process's pool for those sessions plus the connections the migration itself opens. Each pool `max` is per process; the database still sees one session from every replica that is waiting, and one extra from the holder. Two `migrate()` calls in one process that share a lock key wait for each other before either checks out a connection.

Advisory strategies need no extra DDL privileges. Table strategies only create the lock objects above — not your application schema. If the app user cannot create tables, create those objects in a migration/admin step and keep using the same `tableName`.

## Long migrations

An advisory lock stays held for the whole run, including a migration that takes many minutes. Raise `timeoutMs` above that duration so the other replicas wait instead of failing:

```typescript
// driver and migrationRunner from Basic Usage (inject the DB client in the runner constructor)
const coordinator = new MigrationCoordinator({
  driver,
  lockProvider: new PostgresAdvisoryLock(), // or MySQLAdvisoryLock / MssqlAppLock
  migrationRunner,
  retryConfig: { timeoutMs: 30 * 60 * 1000 },
});
```

`MySQLAdvisoryLock` and `MssqlAppLock` use the same `timeoutMs`. `wait: 'database'` is the default: one blocking call inside the database. See [`examples/long-migration-example.ts`](./examples/long-migration-example.ts).

A table lock expires unless it is renewed. For a long run, set `leaseMs` longer than a single slow statement and keep `renewIntervalMs` under half of that lease. Waiters poll `maxRetries * retryIntervalMs`:

```typescript
// driver and migrationRunner from Basic Usage (inject the DB client in the runner constructor)
const coordinator = new MigrationCoordinator({
  driver,
  lockProvider: new PostgresTableLock({ leaseMs: 120_000 }), // MySQLTableLock / SqliteTableLock too
  migrationRunner,
  renewIntervalMs: 20_000,
  retryConfig: { maxRetries: 900, retryIntervalMs: 2000 },
});
```

While acquiring a lock, the coordinator retries transient connection failures and deadlocks (`ECONNRESET`, Postgres `57P01` / `40P01` / `40001`, MySQL deadlock 1213, and the same class of errors from other drivers). A database-wait lock that returns false has already waited inside the server, so that result is not retried. A non-transient query error throws `LockAcquisitionError` or `MigrationExecutionError`.

## Releasing a stuck lock

`migrate()` calls `release()` when it finishes, including when the migration throws. A crashed process is different for each lock.

| Lock | After a crash | Clear it by hand |
|---|---|---|
| `PostgresAdvisoryLock` | The database drops it when the connection closes. A hung process that still owns the session keeps it. | There is no `forceRelease`. Disconnect the holder, or `SELECT pg_terminate_backend(pid)` for the backend in `pg_locks` where `locktype = 'advisory'`. `release(driver)` runs `pg_advisory_unlock` on that same session. `scope: 'transaction'` ends at `COMMIT` or `ROLLBACK`. |
| `MySQLAdvisoryLock` | `GET_LOCK` ends when that session disconnects. | There is no `forceRelease`. `release(driver)` runs `RELEASE_LOCK` on that session. Otherwise kill the connection that holds the name. |
| `MssqlAppLock` | `sp_getapplock` ends when that session disconnects. | There is no `forceRelease`. `release(driver)` runs `sp_releaseapplock` on that session. `scope: 'transaction'` ends at `COMMIT` or `ROLLBACK`. Otherwise kill the SQL Server session. |
| `PostgresTableLock`, `MySQLTableLock`, `SqliteTableLock`, `CockroachTableLock`, `YugabyteTableLock` | The next replica takes the row after `expires_at` (default 30 seconds). | `status(driver)` shows `holder`, `lockedAt`, and `expiresAt`. `forceRelease(driver)` deletes the row. `release(driver)` deletes it only when this process is the holder. |
| `OracleAppLock` | `DBMS_LOCK` ends when that session disconnects. | There is no `forceRelease`. `release(driver)` runs `DBMS_LOCK.RELEASE` on that session. Otherwise kill the session that holds the `UL` lock. `scope: 'transaction'` ends at `COMMIT` or `ROLLBACK`. |

PgBouncer in transaction mode returns the server connection after each transaction, so a Postgres session advisory lock does not stay held. Use `PostgresTableLock` in that mode. Session pooling keeps the backend and is compatible with `PostgresAdvisoryLock`. CockroachDB and YugabyteDB do not offer `pg_advisory_lock`; their packages use the table lease only.

```typescript
const lock = new PostgresTableLock(); // or MySQLTableLock / SqliteTableLock
const status = await lock.status(driver);
await lock.forceRelease(driver);
```

[`examples/release-lock-example.ts`](./examples/release-lock-example.ts) does this for Postgres, MySQL, and SQLite.

## 🛠️ Development

Requires **Node.js 24.15** or newer. CI runs unit tests on Node 24, 25, and 26. End-to-end runs on Node 26, and each dialect suite runs on the current server image and the previous major. `NODE_VERSION` selects the suite image (`24` or `26`, default `26`).

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run unit tests
npm test

# Concurrent e2e (podman-compose or docker compose), one suite per adapter
npm run test:e2e:postgres:node-pg
npm run test:e2e:mysql:mysql2
npm run test:e2e:typeorm:postgres
npm run test:e2e:typeorm:mysql
npm run test:e2e:sequelize:postgres
npm run test:e2e:sequelize:mysql
npm run test:e2e:sqlite:node-sqlite
npm run test:e2e:mssql:tedious
npm run test:e2e:oracle:oracledb
npm run test:e2e:cockroach:pg
npm run test:e2e:yugabyte:pg
npm run test:e2e:mikroorm:postgres
npm run test:e2e:kysely:postgres

# Node 24 image. Pull-request end-to-end stays on Node 26; this runs the suite image locally.
NODE_VERSION=24 npm run test:e2e:postgres:node-pg

# Previous database major. Pull requests run these beside the current image.
POSTGRES_IMAGE=docker.io/library/postgres:17-alpine npm run test:e2e:postgres:node-pg
MYSQL_IMAGE=docker.io/library/mysql:8.4 npm run test:e2e:mysql:mysql2
MYSQL_IMAGE=docker.io/library/mariadb:11.8 npm run test:e2e:mysql:mysql2
MYSQL_IMAGE=docker.io/library/mariadb:10.11 npm run test:e2e:mysql:mysql2
MSSQL_IMAGE=mcr.microsoft.com/mssql/server:2019-latest npm run test:e2e:mssql:tedious
COCKROACH_IMAGE=docker.io/cockroachdb/cockroach:v24.3.37 npm run test:e2e:cockroach:pg
YUGABYTE_IMAGE=docker.io/yugabytedb/yugabyte:2025.2.8.0-b60 npm run test:e2e:yugabyte:pg
```

Multi-replica apps live in [`examples/`](./examples) (NestJS/Express/Fastify + TypeORM, NestJS + Sequelize, NestJS + Knex, NestJS + SQLite, NestJS and Express + SQL Server, NestJS + Prisma) against Postgres, MySQL, SQLite, and SQL Server.

## 🤝 Contributing

We welcome contributions! Here's how you can help:

1. **Add support for new databases** (MySQL, SQLite, SQL Server, etc.)
2. **Add new lock strategies** for existing databases
3. **Improve documentation** and examples
4. **Report bugs** and suggest features

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

### Adding a New Database

To add support for a new database:

1. Create a new package in `packages/your-database/`
2. Implement `SqlDriver` for your database client
3. Implement one or more `LockProvider` strategies
4. Add tests and documentation
5. Submit a PR!

See [examples/custom-database-example.ts](./examples/custom-database-example.ts) for a complete example.

## 📄 License

MIT © [Your Name]

## 🙏 Acknowledgments

Inspired by:
- [Liquibase](https://www.liquibase.org/) - Database change management
- [Flyway](https://flywaydb.org/) - Database migrations
- [node-pg-migrate](https://github.com/salsita/node-pg-migrate) - PostgreSQL migrations

## 🔗 Related Projects

- [TypeORM](https://typeorm.io/) - ORM with built-in migrations
- [Knex](http://knexjs.org/) - SQL query builder with migrations
- [Sequelize](https://sequelize.org/) - ORM with migrations
- [Prisma](https://www.prisma.io/) - Modern ORM with migrations

---

**Note**: This library focuses solely on distributed locking for migrations. It doesn't handle migration file management, versioning, or execution - use it with your existing migration tool of choice.
