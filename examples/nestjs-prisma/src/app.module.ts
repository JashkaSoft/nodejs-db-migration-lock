import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

@Controller()
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('/health')
  async health() {
    const users = await this.prisma.user.count();
    return {
      ok: true,
      framework: 'nestjs',
      orm: 'prisma',
      replica: process.env.REPLICA_ID || 'unknown',
      dbType: 'postgres',
      users,
    };
  }
}

@Module({
  controllers: [HealthController],
  providers: [PrismaService],
})
export class AppModule {}
