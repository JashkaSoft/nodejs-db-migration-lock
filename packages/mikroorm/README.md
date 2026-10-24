# @nodejs-db-migration-lock/mikroorm

MikroORM adapter (`SqlDriver`). Lock SQL stays in the dialect packages. This driver checks out one native connection for the lock and a second connection, through `fork()`, for a table-lock heartbeat.

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/mikroorm @mikro-orm/core @mikro-orm/postgresql
```

```typescript
import { MikroORM } from '@mikro-orm/postgresql';
import { MigrationCoordinator } from '@nodejs-db-migration-lock/core';
import { MikroORMDriver } from '@nodejs-db-migration-lock/mikroorm';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

const orm = await MikroORM.init({ /* host, dbName, entities */ });
const coordinator = new MigrationCoordinator({
  driver: new MikroORMDriver(orm),
  lockProvider: new PostgresTableLock(),
  migrationRunner,
});
await coordinator.migrate();
```

`getNativeClient()` must be a pool with `connect()` (`pg`) or `getConnection()` (`mysql2`). `close()` releases that session and, unless the driver was forked, closes the ORM.
