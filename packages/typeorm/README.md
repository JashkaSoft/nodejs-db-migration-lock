# @nodejs-db-migration-lock/typeorm

TypeORM `DataSource` adapter (`SqlDriver`). Lock strategies stay in database packages (`postgres`, `mysql`, …) so a TypeORM change does not require touching every dialect.

## Installation

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/typeorm
npm install typeorm
# plus a dialect package, e.g. @nodejs-db-migration-lock/postgres
```

## Usage

```typescript
import { DataSource } from 'typeorm';
import { MigrationCoordinator } from '@nodejs-db-migration-lock/core';
import { TypeORMDriver } from '@nodejs-db-migration-lock/typeorm';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

await dataSource.initialize();

const coordinator = new MigrationCoordinator({
  driver: new TypeORMDriver(dataSource),
  lockProvider: new PostgresTableLock(),
  migrationRunner,
});
await coordinator.migrate();
```
