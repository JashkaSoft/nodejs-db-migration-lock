# Express + TypeORM replicas

Fresh Express + TypeORM app. Three replicas race migrations against Postgres and MySQL.

```bash
cd examples/express-typeorm
podman-compose up --build
```

Health: `http://localhost:3101/health` … `3103` (Postgres), `3111` … `3113` (MySQL).
