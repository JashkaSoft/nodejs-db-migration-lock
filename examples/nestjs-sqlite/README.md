# NestJS + SQLite replicas

Three replicas share one SQLite file. Startup runs schema DDL behind `MigrationCoordinator` and `SqliteTableLock`.

Uses `@nodejs-db-migration-lock/sqlite` (`NodeSqliteDriver` + `node:sqlite`). WAL mode lets the processes share `/data/app.db`.

```bash
cd examples/nestjs-sqlite
podman-compose up --build
```

Health: `http://localhost:3501/health` … `3503`.

Lock object: table strategy creates `migration_lock`.
