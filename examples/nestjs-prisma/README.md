# NestJS + Prisma replicas

Three replicas share one Postgres database. Startup holds `PostgresTableLock` and, while that lease is held, runs `prisma migrate deploy`. The process listens only after the lock is released.

Prisma Migrate also takes its own Postgres advisory lock inside `migrate deploy`. PgBouncer transaction mode drops that advisory lock. The table lease is what keeps the three Nest processes from deploying at the same time, and it still works behind transaction pooling.

```bash
cd examples/nestjs-prisma
podman-compose up --build
```

Health: `http://localhost:3801/health` … `3803`. A healthy replica reports `users: 1`.

Lock object: `PostgresTableLock` creates `migration_lock.migration_lock`. The table sits outside `public` because `prisma migrate deploy` will not start when `public` already has tables and no `_prisma_migrations` history. Prisma records applied files in `public._prisma_migrations`.
