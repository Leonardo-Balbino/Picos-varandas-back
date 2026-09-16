import { Module } from '@nestjs/common';
import { InfraModule } from './infra/infra.module';
import { FechamentoModule } from './modules/fechamento/fechamento.module';
import { BackupValidationWorker } from './modules/sync/backups/backup-validation.worker';
import { BackupExtractorService } from './modules/sync/backups/backup-extractor.service';
import { VendasSyncService } from './modules/sync/vendas/vendas-sync.service';

@Module({
  imports: [InfraModule, FechamentoModule],
  providers: [
    BackupValidationWorker,
    BackupExtractorService,
    VendasSyncService,
  ],
})
export class BackupWorkerModule {}

