import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Dois endpoints distintos por design (seção 3.7) — um health check que
 * consulta o banco a cada minuto acordaria o Neon permanentemente e
 * consumiria as 100 CU-hours do tier gratuito.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Startup e liveness probe do Cloud Run. Nunca toca no banco. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Uso manual e diagnóstico apenas. Nunca agendar (proibido na seção 3.7). */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; database: 'connected' }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'connected' };
  }
}
