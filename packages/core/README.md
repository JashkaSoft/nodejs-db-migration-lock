# @nodejs-db-migration-lock/core

Core functionality for database migration locking. This package provides database-agnostic interfaces and coordination logic for distributed migration locks.

## Features

- 🔒 **Lock Coordination** - Ensure only one process runs migrations at a time
- 🔄 **Retry Logic** - Built-in retry mechanism with configurable timeouts
- 🎯 **Database Agnostic** - Works with any SQL database through driver adapters
- 🛡️ **Type Safe** - Full TypeScript support with comprehensive types
- ⚡ **Flexible** - Support for different lock strategies (advisory, table-based, etc.)

## Installation

```bash
npm install @nodejs-db-migration-lock/core
```

## Architecture

The library is built around three main interfaces:

### 1. SqlDriver

An interface that abstracts database query execution. Clients implement this to connect their database client.

```typescript
interface SqlDriver {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
  close?(): Promise<void>;
  fork?(): Promise<SqlDriver>;
}
```

### 2. LockProvider

An interface that defines how locks are acquired and released.

```typescript
interface LockProvider {
  name: string;
  lockKey?: string;
  waitsInDatabase?: boolean;
  transactionScoped?: boolean;
  ensureInfrastructure?(driver: SqlDriver): Promise<void>;
  acquire(driver: SqlDriver, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<boolean>;
  release(driver: SqlDriver): Promise<void>;
  renew?(driver: SqlDriver): Promise<boolean>;
  status?(driver: SqlDriver): Promise<LockStatus | null>;
  forceRelease?(driver: SqlDriver): Promise<void>;
  healthcheck?(driver: SqlDriver): Promise<boolean>;
}
```

### 3. MigrationRunner

An interface for executing your actual migrations.

```typescript
interface MigrationRunner {
  run(): Promise<void>;
}
```

## Usage

```typescript
import { 
  MigrationCoordinator, 
  SqlDriver, 
  LockProvider, 
  MigrationRunner 
} from '@nodejs-db-migration-lock/core';

// Implement your driver
class MyDriver implements SqlDriver {
  async query(sql: string, params?: unknown[]) {
    // Your database query logic
  }
}

// Implement your lock provider
class MyLockProvider implements LockProvider {
  name = 'my-lock';
  
  async acquire(driver: SqlDriver): Promise<boolean> {
    // Your lock acquisition logic
    return true;
  }
  
  async release(driver: SqlDriver): Promise<void> {
    // Your lock release logic
  }
}

// Implement your migration runner (inject dependencies in the constructor)
class MyMigrationRunner implements MigrationRunner {
  constructor(private readonly driver: MyDriver) {}

  async run(): Promise<void> {
    // Your migration logic
  }
}

// Coordinate the migration
const driver = new MyDriver();
const coordinator = new MigrationCoordinator({
  driver,
  lockProvider: new MyLockProvider(),
  migrationRunner: new MyMigrationRunner(driver),
  retryConfig: {
    maxRetries: 60,
    retryIntervalMs: 2000,
  },
  onLockWaiting: (attempt, maxRetries) => {
    console.log(`Waiting for lock... (${attempt}/${maxRetries})`);
  },
  onLockAcquired: () => {
    console.log('Lock acquired!');
  },
  onMigrationComplete: () => {
    console.log('Migration complete!');
  },
});

await coordinator.migrate();
```

## Error Handling

The library provides typed errors:

- `MigrationLockError` - Base error class
- `LockAcquisitionError` - Failed to acquire lock
- `LockTimeoutError` - Lock acquisition timed out
- `MigrationExecutionError` - Migration failed to execute

```typescript
try {
  await coordinator.migrate();
} catch (error) {
  if (error instanceof LockTimeoutError) {
    console.error(`Timeout after ${error.retries} retries`);
  } else if (error instanceof MigrationExecutionError) {
    console.error('Migration failed:', error.cause);
  }
}
```

## Database-Specific Packages

For ready-to-use implementations, see:

- [@nodejs-db-migration-lock/postgres](../postgres) - PostgreSQL support with advisory and table-based locks
- [@nodejs-db-migration-lock/mysql](../mysql) - MySQL/MariaDB `GET_LOCK` and table locks
- [@nodejs-db-migration-lock/sqlite](../sqlite) - SQLite table lock and `node:sqlite` driver

## License

MIT

