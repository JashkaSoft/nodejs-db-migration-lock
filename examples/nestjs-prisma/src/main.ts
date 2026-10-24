import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { runLockedMigrations } from './run-locked-migrations.js';

async function bootstrap(): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }
  await runLockedMigrations(databaseUrl);

  const app = await NestFactory.create(AppModule);
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  console.log(`[replica ${replica}] nestjs+prisma listening on ${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
