# @nodejs-db-migration-lock/kysely

Kysely adapter (`SqlDriver`). Lock SQL stays in the dialect packages. The driver holds one pooled connection for the lock and a second connection, through `fork()`, for a table-lock heartbeat.

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/kysely kysely
```

```typescript
import { CompiledQuery, Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { KyselyDriver } from '@nodejs-db-migration-lock/kysely';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

class MyMigrationRunner implements MigrationRunner {
  constructor(private readonly db: Kysely<unknown>) {}

  async run(): Promise<void> {
    await this.db.executeQuery(CompiledQuery.raw('SELECT 1'));
  }
}

const db = new Kysely({ dialect: new PostgresDialect({ pool: new Pool({ max: 4 }) }) });
const coordinator = new MigrationCoordinator({
  driver: new KyselyDriver(db),
  lockProvider: new PostgresTableLock(),
  migrationRunner: new MyMigrationRunner(db),
});
await coordinator.migrate();
```

`close()` releases the held session and, unless the driver was forked, calls `db.destroy()`.
