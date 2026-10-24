# @nodejs-db-migration-lock/knex

Knex adapter (`SqlDriver`). Lock strategies stay in database packages (`postgres`, `mysql`, …) so a Knex change does not require touching every dialect.

Knex is database-agnostic, like TypeORM and Sequelize, so it belongs in its own package rather than inside `postgres` or `mysql`.

## Installation

```bash
npm install @nodejs-db-migration-lock/core @nodejs-db-migration-lock/knex
npm install knex
# plus a dialect package, e.g. @nodejs-db-migration-lock/postgres
```

## Usage

```typescript
import knex, { Knex } from 'knex';
import { MigrationCoordinator, MigrationRunner } from '@nodejs-db-migration-lock/core';
import { KnexDriver } from '@nodejs-db-migration-lock/knex';
import { PostgresTableLock } from '@nodejs-db-migration-lock/postgres';

class KnexMigrationRunner implements MigrationRunner {
  constructor(private readonly db: Knex) {}

  async run(): Promise<void> {
    await this.db.migrate.latest();
  }
}

const db = knex({ client: 'pg', connection: process.env.DATABASE_URL });

const coordinator = new MigrationCoordinator({
  driver: new KnexDriver(db),
  lockProvider: new PostgresTableLock(),
  migrationRunner: new KnexMigrationRunner(db),
});
await coordinator.migrate();
```

`KnexDriver` maps Postgres `$1` placeholders to Knex `?` bindings so dialect lock SQL can run unchanged.

Use a table lock with a Knex pool. Advisory locks are session-scoped and need a pinned connection.
