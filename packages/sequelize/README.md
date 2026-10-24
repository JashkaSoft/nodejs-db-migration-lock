# @nodejs-db-migration-lock/sequelize

Sequelize adapter (`SqlDriver`). Lock strategies stay in database packages (`postgres`, `mysql`, …) so a Sequelize change does not require touching every dialect.

## Installation

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/sequelize
npm install sequelize
# plus a dialect package, e.g. @nodejs-db-migration-lock/postgres
```

## Usage

```typescript
import { Sequelize } from 'sequelize';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { SequelizeDriver } from '@nodejs-db-migration-lock/sequelize';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

class SequelizeMigrationRunner implements MigrationRunner {
  constructor(private readonly sequelize: Sequelize) {}

  async run(): Promise<void> {
    // Pair with Umzug or Sequelize CLI — see examples/nestjs-sequelize
    await this.sequelize.authenticate();
  }
}

const sequelize = new Sequelize(/* ... */);

const coordinator = new MigrationCoordinator({
  driver: new SequelizeDriver(sequelize),
  lockProvider: new PostgresTableLock(),
  migrationRunner: new SequelizeMigrationRunner(sequelize),
});
await coordinator.migrate();
```

Pair with Umzug (or Sequelize CLI) inside `MigrationRunner.run()`. Concurrent e2e lives in this package (`tests/e2e/postgres`, `tests/e2e/mysql`).

```bash
npm run test:e2e:sequelize:postgres
npm run test:e2e:sequelize:mysql
```
