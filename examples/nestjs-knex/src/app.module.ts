import { Controller, Get, Module } from '@nestjs/common';

@Controller()
class HealthController {
  @Get('/health')
  health() {
    return {
      ok: true,
      framework: 'nestjs',
      queryBuilder: 'knex',
      replica: process.env.REPLICA_ID || 'unknown',
      dbType: process.env.DB_TYPE || 'postgres',
    };
  }
}

@Module({
  controllers: [HealthController],
})
export class AppModule {}
