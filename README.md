# nodejs-db-migration-lock

> A database-agnostic migration lock library for Node.js, similar to Liquibase's lock system but designed specifically for Node.js applications.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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

// Create a migration runner
class MyMigrationRunner implements MigrationRunner {
  async run() {
    await dataSource.runMigrations({ transaction: 'all' });
  }
}

// Coordinate the migration with locking
const coordinator = new MigrationCoordinator({
  driver: new TypeORMDriver(dataSource),
  lockProvider: new PostgresTableLock(),
  migrationRunner: new MyMigrationRunner(),
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

const coordinator = new MigrationCoordinator({
  driver: new NodePgDriver(pool),
  lockProvider: new PostgresAdvisoryLock(),
  migrationRunner: new MyMigrationRunner(),
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

The coordinator renews the lease while migrations run. `release()` deletes the row only when `holder` matches. `forceRelease()` clears it after a crash if you do not want to wait for `expires_at`. Creates (if missing) `migration_lock`. The DB user needs `CREATE` on the schema (or pre-create the table). An older `id`/`created_at` lock table gets the new columns on startup.

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

ORM drivers (`TypeORMDriver`, `SequelizeDriver`, `KnexDriver`) check out one connection for lock SQL. Run the migration on the ORM's own pool. Two `migrate()` calls in one process that share a lock key wait for each other before they pin a second connection.

Advisory strategies need no extra DDL privileges. Table strategies only create the lock objects above — not your application schema. If the app user cannot create tables, create those objects in a migration/admin step and keep using the same `tableName`.

## 🛠️ Development

Requires **Node.js 26** (CI and Docker) or at least **24.15**.

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

# Same mysql2 suite against the LTS servers people still run.
# Pull requests stay on MySQL 9.7. These two run on main and weekly.
MYSQL_IMAGE=docker.io/library/mysql:8.4 npm run test:e2e:mysql:mysql2
MYSQL_IMAGE=docker.io/library/mariadb:11.8 npm run test:e2e:mysql:mysql2
```

Multi-replica apps live in [`examples/`](./examples) (NestJS/Express/Fastify + TypeORM, NestJS + Sequelize, NestJS + Knex, NestJS + SQLite) against Postgres, MySQL, and SQLite.

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
