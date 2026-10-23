# NestJS + SQL Server replicas

Three replicas share one SQL Server. Startup runs schema DDL behind `MigrationCoordinator` and `MssqlAppLock` (`sp_getapplock` on one tedious connection).

```bash
cd examples/nestjs-mssql
podman-compose up --build
```

Health: `http://localhost:3601/health` … `3603`.

Lock object: session application lock `nodejs_db_migration_lock:app`. No lock table.
