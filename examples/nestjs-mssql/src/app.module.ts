import { Controller, Get, Module } from '@nestjs/common';

@Controller()
class HealthController {
  @Get('/health')
  health() {
    return {
      ok: true,
      framework: 'nestjs',
      driver: 'tedious',
      replica: process.env.REPLICA_ID || 'unknown',
      dbType: 'mssql',
    };
  }
}

@Module({
  controllers: [HealthController],
})
export class AppModule {}
