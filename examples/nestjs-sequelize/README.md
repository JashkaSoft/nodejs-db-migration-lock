# NestJS + Sequelize replicas

Startup runs **Umzug** (Sequelize migrations) behind `MigrationCoordinator`. Three replicas race Postgres **and** MySQL; only one holds the lock.

There is no `@nodejs-db-migration-lock/sequelize` package. `SequelizeDriver` in this example implements `SqlDriver` around `sequelize.query()`.

```bash
cd examples/nestjs-sequelize
podman-compose up --build
```

Health: `http://localhost:3301/health` … `3303` (Postgres), `3311` … `3313` (MySQL).

Lock objects: table strategy creates `migration_lock` (and Postgres `migration_lock_id_seq`). Umzug also uses `SequelizeMeta`.
