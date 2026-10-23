---
name: new-package
description: >-
  Add a dialect package, ORM/query-builder adapter, e2e suite, or NestJS replica
  example in this Lerna monorepo. Use when creating packages/*, examples/*,
  adapter e2e, Dockerfiles, or wiring CI/root scripts for a new database or ORM.
---

# New package or example

Human docs stay in `CONTRIBUTING.md`, `ARCHITECTURE.md`, and the example README. This skill is the agent checklist. **Clone a live package**, do not copy the MySQL snippets in CONTRIBUTING (`src/__tests__`, `examples/mysql-example.ts` are stale).

## Decide the kind

| Kind | Package contains | Clone |
|------|------------------|--------|
| Dialect (mssql, oracle, …) | `LockProvider` + native `SqlDriver` only | `packages/sqlite` or `packages/postgres` |
| ORM / query builder | `SqlDriver` adapter only; **no lock SQL** | `packages/typeorm` |
| Example | Nest replicas racing the lock at startup | `examples/nestjs-sqlite` (one DB) or `examples/nestjs-sequelize` (pg+mysql) |

Never put TypeORM, Sequelize, or Knex inside a dialect package. Pair ORM adapters with a dialect lock at the call site.

Do not create Next.js unless the user asked for Next.js. Replica examples are NestJS (`examples/nestjs-*`). Express/Fastify exist only as extra HTTP examples.

## Dialect / adapter package

1. `packages/<name>/` with `src/` (`index.ts` re-exports), `tests/unit/`, `tests/jest.config.unit.js` mapping `@nodejs-db-migration-lock/core` to `../core/src`.
2. `package.json`: `@nodejs-db-migration-lock/<name>`, `files: ["dist", "README.md"]`, depends on `core` only. Client libraries are **peerDependencies** (optional meta). Independent `0.1.0`.
3. `tsconfig.json`: extend root, `references: [{ "path": "../core" }]`.
4. Implement `SqlDriver` / `LockProvider` from `@nodejs-db-migration-lock/core`. Do not change `MigrationCoordinator` for a new dialect.
5. Unit tests next to `tests/unit/`, not under `src/`.
6. Package `README.md`: install, usage, which lock objects are created.

### Concurrent e2e (required for a new driver or lock)

Clone `packages/postgres/tests/e2e` (SQL server) or `packages/sqlite/tests/e2e` (file DB).

- Suite dir `tests/e2e/<suite>/`: `migrate.ts`, `verify.ts`, `docker-compose.yml`, `package.json` (`file:../../../../<deps>`), `tsconfig.json`.
- Shared `tests/e2e/Dockerfile` + `run-test.sh`. `COMPOSE_PROJECT_NAME=migration-lock-<pkg>-<suite>`.
- Three migrators + `test-runner`. Images: `docker.io/library/node:26-alpine` and current DB images. Prefer `podman-compose`.
- **COPY only packages the image imports.** Root `workspaces` glob does **not** require sibling folders. See [docker-workspace-copy](../../rules/docker-workspace-copy.mdc).
- ORM e2e lives in the ORM package and also copies the dialect lock package used by that suite (`packages/${E2E_SUITE}` when the suite name is `postgres` or `mysql`).

Wire `package.json` scripts (`test:e2e`, `test:e2e:<suite>`), root `package.json` (`test:e2e` chain + `test:e2e:<pkg>`), and `.github/workflows/ci.yml` job `e2e-<pkg>-<suite>` on Node 26.

## Nest replica example

Clone `examples/nestjs-sqlite` (shape) and the closest dialect example for ports/DB services.

- `examples/nestjs-<stack>/`: `src/` (`main`, `app.module`, `run-locked-migrations`, connection helper), `Dockerfile`, `docker-compose.yml`, `package.json` with `file:../../packages/...` only for packages used, `README.md` with compose command and health ports.
- Three replicas, lock on startup via `MigrationCoordinator`. Unique host ports (existing: typeorm 3001–3003 / 3101–3103, sequelize 3301–3303 / 3311–3313, knex 3401–3403 / 3411–3413, sqlite 3501–3503).
- Example `Dockerfile` copies **only** those workspace packages. Context is repo root.

## Docs after the code

Update root `README.md` (package table, install, e2e command), `ARCHITECTURE.md` (new package section), `CONTRIBUTING.md` (tree), `packages/core/README.md` if it listed the dialect as missing.

## Verify

`npm run build`, unit tests for the new package, the new e2e script, and `podman-compose up --build` health for a new example. Do not commit unless asked; use the conventional-commit skill when committing.
