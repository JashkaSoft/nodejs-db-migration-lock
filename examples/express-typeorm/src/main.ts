import 'reflect-metadata';
import express from 'express';
import { createDataSource } from './data-source';
import { runLockedMigrations } from './run-locked-migrations';

async function bootstrap(): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';
  const dataSource = createDataSource();
  await dataSource.initialize();
  await runLockedMigrations(dataSource);

  const app = express();
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      framework: 'express',
      replica,
      dbType: process.env.DB_TYPE || 'postgres',
    });
  });

  const port = parseInt(process.env.PORT || '3000', 10);
  await new Promise<void>((resolve) => {
    app.listen(port, () => resolve());
  });
  console.log(`[replica ${replica}] express listening on ${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
