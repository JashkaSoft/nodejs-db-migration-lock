import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createSequelize } from './create-sequelize';
import { runLockedMigrations } from './run-locked-migrations';

async function bootstrap(): Promise<void> {
  const replica = process.env.REPLICA_ID || 'unknown';
  const sequelize = createSequelize();
  await sequelize.authenticate();
  await runLockedMigrations(sequelize);

  const app = await NestFactory.create(AppModule);
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  console.log(`[replica ${replica}] nestjs+sequelize listening on ${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
