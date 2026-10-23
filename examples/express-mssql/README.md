# Express + SQL Server replicas

Three replicas share one SQL Server. Startup runs schema DDL behind `MigrationCoordinator` and `MssqlAppLock` (`sp_getapplock` on one tedious connection).

```bash
cd examples/express-mssql
podman-compose up --build
```

Health: `http://localhost:3701/health` … `3703`.

Lock object: session application lock `nodejs_db_migration_lock:app`. No lock table.
