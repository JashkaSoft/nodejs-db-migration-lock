import 'reflect-metadata';
import Fastify from 'fastify';
import { createDataSource } from './data-source';
import { runLockedMigrations } from './run-locked-migrations';

async function bootstrap(): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';
  const dataSource = createDataSource();
  await dataSource.initialize();
  await runLockedMigrations(dataSource);

  const app = Fastify();
  app.get('/health', async () => ({
    ok: true,
    framework: 'fastify',
    replica,
    dbType: process.env.DB_TYPE || 'postgres',
  }));

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[replica ${replica}] fastify listening on ${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
