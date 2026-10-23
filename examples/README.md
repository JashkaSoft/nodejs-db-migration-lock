# Examples

Standalone TypeORM snippets:

- `typeorm-example.ts`
- `node-pg-example.ts`
- `custom-database-example.ts`

Runnable multi-replica apps (Postgres **and** MySQL, three replicas each):

| App | Stack | Compose |
|-----|--------|---------|
| [`nestjs-typeorm`](./nestjs-typeorm) | NestJS + TypeORM | ports 3001–3003 / 3011–3013 |
| [`express-typeorm`](./express-typeorm) | Express + TypeORM | ports 3101–3103 / 3111–3113 |
| [`fastify-typeorm`](./fastify-typeorm) | Fastify + TypeORM | ports 3201–3203 / 3211–3213 |

From the repo root, build packages first (`npm install && npm run build`), then `podman-compose up --build` inside an example directory.
