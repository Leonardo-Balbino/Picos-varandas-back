import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';

/**
 * Módulo global de infraestrutura (seção 3.1): configuração de ambiente e
 * serviços transversais que qualquer módulo de domínio pode injetar sem
 * importar este módulo explicitamente.
 *
 * R2Service (Cloudflare R2, Card A4) entra aqui quando aquele card começar.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class InfraModule {}
