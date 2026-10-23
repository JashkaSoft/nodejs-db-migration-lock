# Architecture Documentation

## Overview

This library provides a **database-agnostic migration lock system** for Node.js applications, inspired by Liquibase's lock mechanism. It ensures only one process can run migrations at a time in distributed environments.

## Core Concepts

### 1. Three-Layer Architecture

```
┌─────────────────────────────────────────────────┐
│         MigrationCoordinator                    │
│  (Orchestrates locking + migration execution)   │
└───────────┬─────────────────────────┬───────────┘
            │                         │
            ▼                         ▼
   ┌────────────────┐        ┌─────────────────┐
   │  LockProvider  │        │ MigrationRunner │
   │ (How to lock)  │        │ (What to run)   │
   └────────┬───────┘        └─────────────────┘
            │
            ▼
      ┌──────────┐
      │SqlDriver │
      │(DB Query)│
      └──────────┘
```

### 2. Core Interfaces

#### SqlDriver
The **abstraction** that allows any database client to work with the library.

```typescript
interface SqlDriver {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}
```

**Key Point**: Clients pass their existing database connection wrapped in a `SqlDriver` implementation.

#### LockProvider
Defines **how locks are acquired/released** for a specific database.

```typescript
interface LockProvider {
  name: string;
  ensureInfrastructure?(driver: SqlDriver): Promise<void>;
  acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean>;
  release(driver: SqlDriver): Promise<void>;
  healthcheck?(driver: SqlDriver): Promise<boolean>;
}
```

**Key Point**: Different databases have different locking mechanisms (advisory locks, table-based locks, etc.)

#### MigrationRunner
Defines **what migrations to run**.

```typescript
interface MigrationRunner {
  run(): Promise<void>;
}
```

**Key Point**: This is where you put your actual migration logic (TypeORM, Knex, custom SQL, etc.)

### 3. How Clients Pass Drivers

Clients have three options:

#### Option A: Use Pre-built Adapters

```typescript
import { DataSource } from 'typeorm';
import { TypeORMDriver } from '@nodejs-db-migration-lock/typeorm';

const dataSource = new DataSource({...});
await dataSource.initialize();

// Wrap TypeORM DataSource in adapter
const driver = new TypeORMDriver(dataSource);
```

#### Option B: Use node-postgres Adapter

```typescript
import { Pool } from 'pg';
import { NodePgDriver } from '@nodejs-db-migration-lock/postgres';

const pool = new Pool({...});

// Wrap pg Pool in adapter
const driver = new NodePgDriver(pool);
```

#### Option C: Implement Custom SqlDriver

```typescript
import { SqlDriver } from '@nodejs-db-migration-lock/core';

class MyCustomDriver implements SqlDriver {
  constructor(private myDbClient: any) {}
  
  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    // Adapt your client's query method
    const result = await this.myDbClient.execute(sql, params);
    return result.rows;
  }
}

const driver = new MyCustomDriver(myClient);
```

## Package Structure

### @nodejs-db-migration-lock/core
**Database-agnostic logic**
- Interfaces (SqlDriver, LockProvider, MigrationRunner)
- MigrationCoordinator (orchestration + retry logic)
- Error types
- Retry utilities

**No database-specific code!**

### @nodejs-db-migration-lock/postgres
**PostgreSQL-specific implementations**
- Lock Providers:
  - `PostgresAdvisoryLock` - Session-level locks using `pg_advisory_lock()`
  - `PostgresTableLock` - Table-based locks with INSERT/DELETE
- Driver Adapters:
  - `NodePgDriver` - For node-postgres (pg) users

### @nodejs-db-migration-lock/typeorm
**ORM adapter (database-agnostic)**
- `TypeORMDriver` - wraps a TypeORM `DataSource`
- Pair with a dialect lock package (`postgres`, `mysql`, …)

### @nodejs-db-migration-lock/sequelize
**ORM adapter (database-agnostic)**
- `SequelizeDriver` - wraps a Sequelize instance
- Pair with a dialect lock package (`postgres`, `mysql`, …)

### @nodejs-db-migration-lock/knex
**Query-builder adapter (database-agnostic)**
- `KnexDriver` - wraps a Knex instance
- Pair with a dialect lock package (`postgres`, `mysql`, …)

### @nodejs-db-migration-lock/sqlite
**SQLite-specific implementations**
- `SqliteTableLock` - `INSERT OR IGNORE` into a one-row lock table
- `NodeSqliteDriver` - Node.js `node:sqlite` `DatabaseSync`

### Other packages
- `@nodejs-db-migration-lock/mysql` - MySQL/MariaDB locks + `Mysql2Driver`
- `@nodejs-db-migration-lock/mssql` - Microsoft SQL Server support (planned)

## Lock Strategies

### PostgreSQL Advisory Locks

**Implementation**: Uses PostgreSQL's `pg_try_advisory_lock()`

**Pros**:
- Very fast (no disk I/O)
- Automatically released when connection closes
- No infrastructure needed

**Cons**:
- Session-dependent
- Lost if connection drops

**Use When**: Running migrations within a stable connection context (e.g., Kubernetes pod lifecycle)

### PostgreSQL Table Locks

**Implementation**: Uses a dedicated table with a unique constraint

**Pros**:
- Survives connection drops
- Can query lock status from database
- More visible/debuggable

**Cons**:
- Requires table creation
- Slightly slower (table I/O)
- Must manually cleanup if process crashes

**Use When**: Need robustness across connection drops or want to inspect lock status

## Data Flow

### Successful Migration Flow

```
1. Client creates coordinator with:
   - driver (database connection wrapper)
   - lockProvider (locking strategy)
   - migrationRunner (migration logic)

2. coordinator.migrate() called
   ↓
3. ensureInfrastructure() - Create tables if needed
   ↓
4. acquireLockWithRetry() - Try to get lock
   ├─ If locked → Wait & retry
   └─ If acquired → Continue
   ↓
5. migrationRunner.run() - Execute migrations
   ↓
6. release() - Release lock
   ↓
7. Done ✅
```

### Concurrent Execution (Multiple Processes)

```
Process A                    Process B                    Process C
    │                            │                            │
    ├─ acquire() → ✅            ├─ acquire() → ❌            ├─ acquire() → ❌
    │                            │                            │
    ├─ run migrations            ├─ wait...                   ├─ wait...
    │                            │                            │
    ├─ release() → ✅            │                            │
    │                            ├─ acquire() → ✅            │
    │                            │                            ├─ wait...
    │                            ├─ run migrations            │
    │                            │                            │
    │                            ├─ release() → ✅            │
    │                            │                            ├─ acquire() → ✅
    │                            │                            │
    │                            │                            ├─ run migrations
    │                            │                            │
    │                            │                            ├─ release() → ✅
```

## Migration from Your example.ts

Your current implementation in `example.ts` has the logic but is tightly coupled to TypeORM. Here's the mapping:

| example.ts | New Architecture |
|------------|------------------|
| `ensureLockTableExists()` | `PostgresTableLock.ensureInfrastructure()` |
| `acquireLock()` with retry loop | `MigrationCoordinator.acquireLockWithRetry()` |
| `releaseLock()` | `PostgresTableLock.release()` |
| `migrateDatabase()` | `MigrationCoordinator.migrate()` |
| TypeORM's `dataSource.query()` | `TypeORMDriver.query()` |
| Direct DB access | Abstracted through `SqlDriver` |

### Before (Tightly Coupled)

```typescript
// All logic mixed together, TypeORM-specific
const dataSource = await AppDataSource.initialize();
await ensureLockTableExists(dataSource);
const lockAcquired = await acquireLock(dataSource);
if (lockAcquired) {
  await dataSource.runMigrations();
  await releaseLock(dataSource);
}
```

### After (Separated Concerns)

```typescript
// Clean separation: driver, lock, migration logic
const driver = new TypeORMDriver(dataSource);
const lockProvider = new PostgresTableLock();
const migrationRunner = new TypeORMMigrationRunner(dataSource);

const coordinator = new MigrationCoordinator({
  driver,
  lockProvider,
  migrationRunner,
});

await coordinator.migrate();
```

## Extensibility

### Adding a New Database (e.g., MySQL)

1. **Create Package**: `packages/mysql/`

2. **Implement SqlDriver**:
```typescript
class MySQLDriver implements SqlDriver {
  // Adapt mysql2 or mysql client
}
```

3. **Implement LockProvider(s)**:
```typescript
class MySQLAdvisoryLock implements LockProvider {
  // Use GET_LOCK()
}

class MySQLTableLock implements LockProvider {
  // Use table-based locking
}
```

4. **No changes to core or query-layer adapters.** Keep TypeORM/Sequelize/Knex in their own packages; dialect packages only add locks and native clients (`postgres`, `mysql`, `sqlite`, …).

## Benefits of This Architecture

1. **Separation of Concerns**: Lock logic, migration logic, and database access are separate
2. **Database Agnostic**: Core package has zero database-specific code
3. **Easy Testing**: Each component can be tested independently
4. **Multiple Strategies**: Different lock strategies for different use cases
5. **Framework Independent**: Works with TypeORM, Sequelize, Knex, raw SQL, etc.
6. **Type Safe**: Full TypeScript support throughout
7. **Extensible**: Easy to add new databases or lock strategies

## Real-World Usage Patterns

### Pattern 1: Kubernetes Deployment
```typescript
// All pods try to run migrations at startup
// Only one acquires lock, others wait
const coordinator = new MigrationCoordinator({
  driver: new TypeORMDriver(dataSource),
  lockProvider: new PostgresTableLock(),
  migrationRunner: new TypeORMMigrationRunner(dataSource),
  retryConfig: {
    maxRetries: 60,    // Wait up to 2 minutes
    retryIntervalMs: 2000,
  },
});

await coordinator.migrate();
```

### Pattern 2: CI/CD Pipeline
```typescript
// Multiple pipelines share database
// Each waits its turn
const coordinator = new MigrationCoordinator({
  // ...
  onLockWaiting: (attempt, max) => {
    console.log(`[CI] Waiting for other pipeline... ${attempt}/${max}`);
  },
});
```

### Pattern 3: Development Environment
```typescript
// Fast feedback with advisory locks
const coordinator = new MigrationCoordinator({
  driver: new NodePgDriver(pool),
  lockProvider: new PostgresAdvisoryLock(), // Fast!
  migrationRunner: new CustomMigrationRunner(),
  retryConfig: {
    maxRetries: 5,     // Don't wait long
    retryIntervalMs: 500,
  },
});
```

## Summary

This library provides a **clean, extensible architecture** for distributed migration locking:

- **Core Package**: Database-agnostic interfaces and coordination logic
- **Database Packages**: Specific implementations (Postgres, MySQL, etc.)
- **Driver Adapters**: Connect your existing database clients
- **Lock Strategies**: Different approaches for different needs
- **Easy to Extend**: Follow the pattern to add new databases

The key insight: **Separate "how to query" (SqlDriver) from "how to lock" (LockProvider) from "what to run" (MigrationRunner)**.

