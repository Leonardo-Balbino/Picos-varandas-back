import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Dois endpoints distintos por design (seção 3.7) — um health check de
 * plataforma que consultasse o banco a cada verificação manteria o pool do
 * Postgres sempre ocupado e acoplaria a liveness da API a uma oscilação do
 * banco: se o Postgres piscar, a API seria derrubada junto mesmo saudável.
 * Railway aponta o healthcheck do serviço para /live justamente por isso.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Startup e liveness probe do Railway. Nunca toca no banco. */
  @Public()
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Uso manual e diagnóstico apenas. Nunca agendar (proibido na seção 3.7). */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; database: 'connected' }> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', database: 'connected' };
  }
}
