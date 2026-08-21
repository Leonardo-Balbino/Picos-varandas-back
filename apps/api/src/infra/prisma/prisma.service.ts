import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * Singleton do PrismaService, registrado no módulo global (InfraModule).
 *
 * Prisma 7 (seção 3.4): sem engine Rust, o driver adapter é obrigatório —
 * o PrismaClient fala Postgres através do node-pg (@prisma/adapter-pg).
 *
 * O pool agora é do node-pg, não do engine Prisma. connection_limit e
 * pool_timeout, que antes viviam na query string da DATABASE_URL, deixaram
 * de ter efeito — o equivalente é configurado aqui:
 *   max                     ~ connection_limit (nº de conexões do pool)
 *   connectionTimeoutMillis ~ pool_timeout (espera por conexão livre antes
 *                             de falhar)
 *
 * Construir o adapter/pool aqui NÃO abre conexão — pg.Pool só conecta de
 * fato na primeira query. A conexão continua lazy (seção 3.6, item 4):
 * NÃO chamamos this.$connect() em onModuleInit. Se conectássemos no boot,
 * toda instância — mesmo as que só respondem GET /health/live — acordaria
 * o Neon (scale-to-zero) à toa.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 20_000,
      // SSL NÃO é forçado aqui de propósito — sslmode=require na própria
      // DATABASE_URL já é lido pelo pg-connection-string e habilita TLS
      // (produção, contra o Neon). Setar `ssl` aqui sobrescreveria isso e
      // quebraria Postgres local sem TLS (dev). Diferente do engine Rust,
      // node-pg NÃO ignora certificado inválido silenciosamente por
      // padrão — se aparecer "P1010: User was denied access" ao conectar
      // no Neon, é validação de certificado; configure
      // NODE_EXTRA_CA_CERTS com a CA do Neon (ver README) em vez de
      // desabilitar rejectUnauthorized.
    });

    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    // Só dispara de fato se main.ts chamou app.enableShutdownHooks() — sem
    // isso o Nest nunca escuta SIGTERM e este hook fica morto.
    await this.$disconnect();
    this.logger.log('Conexão com o Postgres encerrada (shutdown gracioso).');
  }
}
