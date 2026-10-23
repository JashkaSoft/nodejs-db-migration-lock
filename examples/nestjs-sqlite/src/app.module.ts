import { Controller, Get, Module } from '@nestjs/common';

@Controller()
class HealthController {
  @Get('/health')
  health() {
    return {
      ok: true,
      framework: 'nestjs',
      driver: 'node:sqlite',
      replica: process.env.REPLICA_ID || 'unknown',
      dbType: 'sqlite',
    };
  }
}

@Module({
  controllers: [HealthController],
})
export class AppModule {}
