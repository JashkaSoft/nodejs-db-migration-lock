# @nodejs-db-migration-lock/cockroach

CockroachDB migration lock. CockroachDB does not implement `pg_advisory_lock`, so this package uses a one-row lease (`holder`, `locked_at`, `expires_at`) through the Postgres wire protocol (`pg`).

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/cockroach pg
```

```typescript
import { Pool } from 'pg';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { CockroachDriver, CockroachTableLock } from '@nodejs-db-migration-lock/cockroach';

const pool = new Pool({ host: 'localhost', port: 26257, user: 'root', database: 'defaultdb' });
const driver = new CockroachDriver(pool);
const lock = new CockroachTableLock();

class MyMigrationRunner implements MigrationRunner {
  constructor(private readonly pool: Pool) {}

  async run(): Promise<void> {
    await this.pool.query('SELECT 1');
  }
}

const coordinator = new MigrationCoordinator({
  driver,
  lockProvider: lock,
  migrationRunner: new MyMigrationRunner(pool),
});
await coordinator.migrate();
await pool.end();
```

The coordinator renews the lease on a second connection. `CockroachDriver` must be constructed with a `pg` Pool so `fork()` can check one out.

## Release the lock by hand

`migrate()` deletes the row when it finishes. After a crash the next replica takes the row once `expires_at` passes (default 30 seconds). To clear it immediately:

```sql
DELETE FROM migration_lock WHERE id = 1;
```

`forceRelease(driver)` runs that statement. `release(driver)` also requires `holder` to match this process, so a new process cannot use it to clear a crashed holder.

```typescript
console.log(await lock.status(driver));
await lock.forceRelease(driver);
```

There is no advisory unlock. Session advisory locks are a Postgres feature this database does not provide.
