import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createDataSource } from './data-source';
import { runLockedMigrations } from './run-locked-migrations';

async function bootstrap(): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';
  const dataSource = createDataSource();
  await dataSource.initialize();
  try {
    await runLockedMigrations(dataSource);
  } finally {
    // Keep the connection for the HTTP process; TypeORM DataSource stays open.
  }

  const app = await NestFactory.create(AppModule);
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  console.log(`[replica ${replica}] nestjs listening on ${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
