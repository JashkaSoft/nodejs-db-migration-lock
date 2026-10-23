# @nodejs-db-migration-lock/mssql

SQL Server migration lock using `sp_getapplock`. The lock is exclusive and tied to one tedious connection. A session lock is released when that connection closes, including after a crash. A transaction lock is released at `COMMIT` or `ROLLBACK`.

## Install

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/mssql
npm install tedious
```

## Usage

```typescript
import { ConnectionConfig } from 'tedious'; // type is ConnectionConfiguration
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { MssqlAppLock, TediousDriver } from '@nodejs-db-migration-lock/mssql';

const driver = new TediousDriver({
  server: 'localhost',
  authentication: {
    type: 'default',
    options: { userName: 'sa', password: 'your-password' },
  },
  options: {
    database: 'app',
    port: 1433,
    encrypt: true,
    trustServerCertificate: true,
  },
});

const coordinator = new MigrationCoordinator({
  driver,
  lockProvider: new MssqlAppLock(),
  migrationRunner: new MyMigrationRunner(),
});

await coordinator.migrate();
await driver.close();
```

`MssqlAppLock()` names the resource `nodejs_db_migration_lock:<database>` via `DB_NAME()`. Pass `lockName` to choose the resource yourself. Pass `scope: 'transaction'` only when the migration runs inside `driver.transaction()`. Session scope is the default.

`sp_getapplock` waits inside SQL Server for the coordinator timeout. It does not create a table. The login needs permission to take an application lock in the current database (`public` is the default principal).

## License

MIT
