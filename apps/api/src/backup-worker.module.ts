import { Module } from '@nestjs/common';
import { InfraModule } from './infra/infra.module';
import { BackupValidationWorker } from './modules/sync/backups/backup-validation.worker';

@Module({ imports: [InfraModule], providers: [BackupValidationWorker] })
export class BackupWorkerModule {}
