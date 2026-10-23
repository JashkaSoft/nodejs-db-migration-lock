import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
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

  const app = await NestFactory.create(AppModule);
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  console.log(`[replica ${replica}] nestjs+mssql listening on ${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
