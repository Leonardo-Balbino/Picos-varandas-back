import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BackupWorkerModule } from './backup-worker.module';
import { BackupValidationWorker } from './modules/sync/backups/backup-validation.worker';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(BackupWorkerModule);
  app.enableShutdownHooks();
  const worker = app.get(BackupValidationWorker);
  const interval = Math.max(5_000, Number(process.env.BACKUP_WORKER_INTERVAL_MS ?? 30_000));
  let stopping = false;
  const stop = async (): Promise<void> => {
    stopping = true;
    await app.close();
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
  while (!stopping) {
    await worker.processarPendentes().catch((erro: unknown) => {
      console.error('Falha no ciclo do worker de backup:', erro instanceof Error ? erro.message : erro);
    });
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

void bootstrap();
