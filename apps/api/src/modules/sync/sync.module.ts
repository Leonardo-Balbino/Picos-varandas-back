import { Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { FechamentoModule } from '../fechamento/fechamento.module';
import { VendasSyncController } from './vendas/vendas-sync.controller';
import { VendasSyncService } from './vendas/vendas-sync.service';
import { HeartbeatService } from './heartbeat.service';
import { BackupUploadController } from './backups/backup-upload.controller';
import { BackupUploadService } from './backups/backup-upload.service';
import { BackupExtractorService } from './backups/backup-extractor.service';
import { BackupValidationWorker } from './backups/backup-validation.worker';

@Injectable()
export class BackupWorkerScheduler implements OnModuleInit, OnModuleDestroy {
  private intervalRef?: NodeJS.Timeout;
  private readonly logger = new Logger(BackupWorkerScheduler.name);

  constructor(private readonly worker: BackupValidationWorker) {}

  onModuleInit() {
    if (!process.env.BACKUP_PRIVATE_KEY_BASE64) {
      this.logger.log(
        'BACKUP_PRIVATE_KEY_BASE64 não configurada na API; execução delegada ao worker-backups dedicado.',
      );
      return;
    }
    this.logger.log(
      'BACKUP_PRIVATE_KEY_BASE64 detectada na API. Ativando processamento integrado em background...',
    );
    const intervalMs = Math.max(5000, Number(process.env.BACKUP_WORKER_INTERVAL_MS ?? 30000));
    this.intervalRef = setInterval(() => {
      this.worker.processarPendentes().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Erro no loop do worker integrado: ${msg}`);
      });
    }, intervalMs);

    // Execução inicial após subida da API
    setTimeout(() => {
      this.worker.processarPendentes().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Erro na execução inicial do worker integrado: ${msg}`);
      });
    }, 3000);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
  }
}

/**
 * Ingestão de vendas do PDV via agente local (I1) e heartbeat /
 * monitoramento do agente (I2). Transporte de backups (I4) com validação
 * criptográfica e motor de extração Dontec Firebird 2.5 integrado.
 */
@Module({
  imports: [FechamentoModule],
  controllers: [VendasSyncController, BackupUploadController],
  providers: [
    VendasSyncService,
    HeartbeatService,
    BackupUploadService,
    BackupExtractorService,
    BackupValidationWorker,
    BackupWorkerScheduler,
  ],
  exports: [VendasSyncService, BackupUploadService, BackupExtractorService, BackupValidationWorker],
})
export class SyncModule {}

