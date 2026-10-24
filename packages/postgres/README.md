# @nodejs-db-migration-lock/postgres

PostgreSQL adapter for database migration locking with support for both advisory locks and table-based locks.

## Features

- 🔒 **Advisory Locks** - Fast, lightweight session-level locks
- 🗄️ **Table-Based Locks** - Persistent locks using a dedicated table
- 🔌 **Drivers** - `NodePgDriver` plus any `SqlDriver` (including TypeORM, Sequelize, and Knex adapters)
- ⚡ **TypeScript** - Full type safety out of the box

## Installation

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/postgres
```

### Peer Dependencies

Depending on your database client, install one of:

```bash
# For node-postgres
npm install pg

# For TypeORM
npm install @nodejs-db-migration-lock/typeorm typeorm

# For Sequelize
npm install @nodejs-db-migration-lock/sequelize sequelize

# For Knex
npm install @nodejs-db-migration-lock/knex knex
```

## Lock Strategies

### Advisory Locks

PostgreSQL advisory locks are fast, lightweight, and automatically released when the connection closes.

**Pros:**
- Very fast (no table I/O)
- Automatically cleaned up on connection loss
- No infrastructure setup needed

**Cons:**
- Session-dependent (lock is lost if connection drops)
- Not visible in database tables

### Table-Based Locks

Uses a dedicated table with a fixed ID to ensure only one lock exists.

**Pros:**
- Survives connection drops
- Visible in database (can query lock status)
- More robust for distributed systems

**Cons:**
- Requires table creation
- Slightly slower (involves table I/O)
- Needs manual cleanup if process crashes

On first use the table lock creates `migration_lock` (or `tableName`) with `holder`, `locked_at`, and `expires_at`. That needs `CREATE` on the schema unless an admin pre-creates the table. Advisory locks create no objects. Omit `lockId` and the advisory key is derived from `current_database()`.

## Usage

### With TypeORM

```typescript
import { DataSource } from 'typeorm';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { TypeORMDriver } from '@nodejs-db-migration-lock/typeorm';
import { PostgresTableLock, PostgresAdvisoryLock } from '@nodejs-db-migration-lock/postgres';

// Initialize TypeORM
const dataSource = new DataSource({
  type: 'postgres',
  host: 'localhost',
  port: 5432,
  username: 'user',
  password: 'password',
  database: 'mydb',
});

await dataSource.initialize();

// Create driver adapter
const driver = new TypeORMDriver(dataSource);

// Choose your lock strategy
const lockProvider = new PostgresTableLock({
  tableName: 'migration_lock',
  lockId: 1,
});
// OR
// const lockProvider = new PostgresAdvisoryLock({ lockId: 123456789 });

// Implement migration runner
class TypeORMMigrationRunner implements MigrationRunner {
  constructor(private dataSource: DataSource) {}
  
  async run(): Promise<void> {
    await this.dataSource.runMigrations({ transaction: 'all' });
  }
}

// Coordinate migration
const coordinator = new MigrationCoordinator({
  driver,
  lockProvider,
  migrationRunner: new TypeORMMigrationRunner(dataSource),
  retryConfig: {
    maxRetries: 60,
    retryIntervalMs: 2000,
  },
  onLockWaiting: (attempt, maxRetries) => {
    console.log(`⏳ Waiting for lock... (${attempt}/${maxRetries})`);
  },
  onLockAcquired: () => {
    console.log('✅ Lock acquired!');
  },
  onMigrationComplete: () => {
    console.log('✅ Migration complete!');
  },
});

try {
  await coordinator.migrate();
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
} finally {
  await dataSource.destroy();
}
```

### With node-postgres (pg)

```typescript
import { Pool } from 'pg';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { 
  NodePgDriver, 
  PostgresTableLock 
} from '@nodejs-db-migration-lock/postgres';

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  user: 'user',
  password: 'password',
  database: 'mydb',
});

const driver = new NodePgDriver(pool);

class CustomMigrationRunner implements MigrationRunner {
  constructor(private readonly pool: Pool) {}

  async run(): Promise<void> {
    await this.pool.query('CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY)');
  }
}

const coordinator = new MigrationCoordinator({
  driver,
  lockProvider: new PostgresTableLock(),
  migrationRunner: new CustomMigrationRunner(pool),
});

await coordinator.migrate();
await pool.end();
```

### Custom Driver

You can create your own driver adapter:

```typescript
import { SqlDriver } from '@nodejs-db-migration-lock/core';
import { Client } from 'pg';

class MyCustomDriver implements SqlDriver {
  constructor(private client: Client) {}
  
  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }
}

const client = new Client({ /* config */ });
await client.connect();

const driver = new MyCustomDriver(client);
```

## API

### PostgresTableLock

```typescript
class PostgresTableLock implements LockProvider {
  constructor(options?: {
    tableName?: string;      // Default: 'migration_lock'
    lockId?: number;         // Default: 1
    advisoryLockId?: number; // Default: 123456789 (for table creation)
  })
}
```

### PostgresAdvisoryLock

```typescript
class PostgresAdvisoryLock implements LockProvider {
  constructor(options?: {
    lockId?: number; // Default: 123456789
  })
}
```

### NodePgDriver

```typescript
class NodePgDriver implements SqlDriver {
  constructor(client: Pool | PoolClient | Client)
}
```

When constructed with a `Pool`, the driver checks out one client and reuses it for every query until `close()`. A `PostgresTableLock` heartbeat checks out a second client only after this process acquires the lock, and releases it when `migrate()` finishes. Advisory locks and `PostgresTableLock` infrastructure setup are session-scoped and will not work correctly if each query uses a different pool connection.

PgBouncer in transaction mode gives the next statement a different backend, so `pg_advisory_lock` does not stay held. Use `PostgresTableLock` behind transaction pooling. Session pooling keeps the backend and works with `PostgresAdvisoryLock`.

## Release the lock by hand

`PostgresAdvisoryLock` has no `forceRelease`. On the session that acquired it:

```sql
SELECT pg_advisory_unlock(<key>);
```

A hung backend is visible in `pg_locks` (`locktype = 'advisory'`). `SELECT pg_terminate_backend(pid)` drops that session and the lock. `scope: 'transaction'` ends at `COMMIT` or `ROLLBACK`.

`PostgresTableLock` keeps a row until it expires or someone deletes it. `forceRelease(driver)` runs:

```sql
DELETE FROM migration_lock WHERE id = 1;
```

`release(driver)` adds `AND holder = $1`. The next waiter also takes the row after `expires_at`.

## Complete Example

See the [examples directory](../../examples) for complete working examples.

## License

MIT

