import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';
import { BackupBucketService } from './storage/backup-bucket.service';

/**
 * Módulo global de infraestrutura (seção 3.1): configuração de ambiente e
 * serviços transversais que qualquer módulo de domínio pode injetar sem
 * importar este módulo explicitamente.
 *
 * StorageService (Card A4) — volume persistente do Railway, não Cloudflare
 * R2 da spec original (decisão desta sessão, ver storage.service.ts).
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
  ],
  providers: [PrismaService, StorageService, BackupBucketService],
  exports: [PrismaService, StorageService, BackupBucketService],
})
export class InfraModule {}
