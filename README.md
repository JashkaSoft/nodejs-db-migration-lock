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
| `@nodejs-db-migration-lock/mysql` | MySQL/MariaDB adapter | Coming soon |
| `@nodejs-db-migration-lock/sqlite` | SQLite adapter | Coming soon |

## 🚀 Quick Start

### Install

```bash
# For PostgreSQL
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/postgres

# Also install your database client if not already installed
npm install typeorm  # or pg, or any other client
```

### Basic Usage with TypeORM

```typescript
import { DataSource } from 'typeorm';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { TypeORMDriver, PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

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
  query<T>(sql: string, params?: any[]): Promise<T[]>;
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

**Advisory Locks** (Fast, automatic cleanup)
```typescript
new PostgresAdvisoryLock({ lockId: 123456789 })
```

**Table Locks** (Persistent, survives connection drops)
```typescript
new PostgresTableLock({ tableName: 'migration_lock' })
```

### MySQL (Coming Soon)

- `MySQLAdvisoryLock` - Using GET_LOCK()
- `MySQLTableLock` - Table-based locks

## 🛠️ Development

Requires **Node.js 26** (CI and Docker) or at least **24.15**.

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run unit tests
npm test

# Run PostgreSQL concurrent e2e tests (podman-compose or docker compose)
npm run test:e2e:postgres
```

MySQL and SQLite adapters are not in this repo yet. The shippable surface is `@nodejs-db-migration-lock/core` plus `@nodejs-db-migration-lock/postgres`.

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
