# Fastify + TypeORM replicas

Fresh Fastify + TypeORM app. Three replicas race migrations against Postgres and MySQL.

```bash
cd examples/fastify-typeorm
podman-compose up --build
```

Health: `http://localhost:3201/health` … `3203` (Postgres), `3211` … `3213` (MySQL).
