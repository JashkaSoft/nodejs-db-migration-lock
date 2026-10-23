import express from 'express';
import { createMssql } from './create-mssql';
import { runLockedMigrations } from './run-locked-migrations';

async function bootstrap(): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';
  const db = await createMssql();
  try {
    await runLockedMigrations(db);
  } finally {
    await db.close();
  }

  const app = express();
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      framework: 'express',
      driver: 'tedious',
      replica,
      dbType: 'mssql',
    });
  });

  const port = parseInt(process.env.PORT || '3000', 10);
  await new Promise<void>((resolve) => {
    app.listen(port, () => resolve());
  });
  console.log(`[replica ${replica}] express+mssql listening on ${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
