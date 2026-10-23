# NestJS + TypeORM replicas

Three NestJS replicas race TypeORM migrations against Postgres **and** MySQL. Only one replica per database holds the lock.

```bash
# from repo root, after npm install && npm run build
cd examples/nestjs-typeorm
podman-compose up --build
# or: docker compose up --build
```

Health:

- Postgres replicas: `http://localhost:3001/health` … `3003`
- MySQL replicas: `http://localhost:3011/health` … `3013`
