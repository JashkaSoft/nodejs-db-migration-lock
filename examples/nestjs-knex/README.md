# NestJS + Knex replicas

Startup runs **Knex migrations** behind `MigrationCoordinator`. Three replicas race Postgres **and** MySQL; only one holds the lock.

Uses `@nodejs-db-migration-lock/knex` (`KnexDriver`). Table locks are used because a Knex pool does not pin one session for advisory locks.

```bash
cd examples/nestjs-knex
podman-compose up --build
```

Health: `http://localhost:3401/health` … `3403` (Postgres), `3411` … `3413` (MySQL).

Lock objects: table strategy creates `migration_lock` (and Postgres `migration_lock_id_seq`). Knex also uses `knex_migrations` / `knex_migrations_lock`.
