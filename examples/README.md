# Examples

Configuration snippets:

- `node-pg-example.ts` — Postgres advisory lock and retry settings
- `typeorm-example.ts` — TypeORM with a Postgres table lock and a 2-minute wait
- `long-migration-example.ts` — advisory lock held across a long migration (`timeoutMs`)
- `release-lock-example.ts` — `status` and `forceRelease` for Postgres, MySQL, and SQLite table locks
- `custom-database-example.ts`

Runnable multi-replica apps (Postgres and MySQL, three replicas each; SQLite shares one file; SQL Server is one database for Nest and Express):

| App | Stack | Compose |
|-----|--------|---------|
| [`nestjs-typeorm`](./nestjs-typeorm) | NestJS + TypeORM | ports 3001–3003 / 3011–3013 |
| [`nestjs-sequelize`](./nestjs-sequelize) | NestJS + `@nodejs-db-migration-lock/sequelize` + Umzug | ports 3301–3303 / 3311–3313 |
| [`express-typeorm`](./express-typeorm) | Express + TypeORM | ports 3101–3103 / 3111–3113 |
| [`fastify-typeorm`](./fastify-typeorm) | Fastify + TypeORM | ports 3201–3203 / 3211–3213 |
| [`nestjs-knex`](./nestjs-knex) | NestJS + `@nodejs-db-migration-lock/knex` | ports 3401–3403 / 3411–3413 |
| [`nestjs-sqlite`](./nestjs-sqlite) | NestJS + `@nodejs-db-migration-lock/sqlite` | ports 3501–3503 |
| [`nestjs-mssql`](./nestjs-mssql) | NestJS + `@nodejs-db-migration-lock/mssql` | ports 3601–3603 |
| [`express-mssql`](./express-mssql) | Express + `@nodejs-db-migration-lock/mssql` | ports 3701–3703 |
| [`nestjs-prisma`](./nestjs-prisma) | NestJS + Prisma Migrate + `PostgresTableLock` | ports 3801–3803 |

From the repo root, build packages first (`npm install && npm run build`), then `podman-compose up --build` inside an example directory.
