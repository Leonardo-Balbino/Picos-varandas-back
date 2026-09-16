import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { BackupBucketService } from '../../../infra/storage/backup-bucket.service';
import { EnvelopeValidationError, validatePvaEnvelope } from './pva-envelope.validator';
import { BackupExtractorService } from './backup-extractor.service';

@Injectable()
export class BackupValidationWorker {
  private readonly logger = new Logger(BackupValidationWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bucket: BackupBucketService,
    private readonly backupExtractor: BackupExtractorService,
  ) {}

  async processarPendentes(): Promise<number> {
    const staleMinutes = Math.max(30, Number(process.env.BACKUP_WORKER_STALE_MINUTES ?? 180));
    await this.prisma.uploadBackupPdv.updateMany({
      where: {
        status: 'processando',
        atualizadoEm: { lt: new Date(Date.now() - staleMinutes * 60_000) },
      },
      data: { status: 'recebido', erroDetalhe: 'Processamento anterior interrompido; retomando.' },
    });
    const pendentes = await this.prisma.uploadBackupPdv.findMany({
      where: { status: 'recebido' },
      orderBy: { recebidoEm: 'asc' },
      take: 5,
    });
    let processados = 0;
    for (const candidato of pendentes) {
      const claim = await this.prisma.uploadBackupPdv.updateMany({
        where: { id: candidato.id, status: 'recebido' },
        data: { status: 'processando', tentativas: { increment: 1 }, erroDetalhe: null },
      });
      if (claim.count !== 1) continue;
      processados += 1;
      await this.validar(candidato.id);
    }
    return processados;
  }

  private async validar(uploadId: string): Promise<void> {
    const upload = await this.prisma.uploadBackupPdv.findUniqueOrThrow({ where: { id: uploadId } });
    const directory = join(tmpdir(), `pva-${randomUUID()}`);
    const envelopePath = join(directory, 'backup.pva');
    const decryptedBackupPath = join(directory, basename(upload.nomeOrigem));
    try {
      await mkdir(directory, { recursive: false, mode: 0o700 });
      const source = await this.bucket.abrir(upload.chaveObjeto);
      const digest = createHash('sha256');
      source.on('data', (chunk: Buffer) => digest.update(chunk));
      await pipeline(source, createWriteStream(envelopePath, { flags: 'wx', mode: 0o600 }));
      if (digest.digest('hex') !== upload.sha256Envelope) {
        throw new EnvelopeValidationError('SHA-256 do objeto armazenado diverge do manifesto.');
      }
      await validatePvaEnvelope(
        envelopePath,
        {
          sourceName: upload.nomeOrigem,
          sourceSize: upload.tamanhoOrigem,
          sourceSha256: upload.sha256Origem,
        },
        decryptedBackupPath,
      );
      this.logger.log(`Backup ${uploadId} autenticado criptograficamente. Iniciando extração do banco Firebird...`);

      const resultado = await this.backupExtractor.extrairEIngerir(upload, decryptedBackupPath);

      await this.prisma.uploadBackupPdv.update({
        where: { id: uploadId },
        data: { status: 'validado', validadoEm: new Date(), erroDetalhe: null },
      });
      this.logger.log(
        `Backup ${uploadId} validado e processado com sucesso: ${resultado.totalVendas} vendas ` +
          `(${resultado.totalCriadas} criadas, ${resultado.totalAtualizadas} atualizadas, ` +
          `${resultado.totalIgnoradas} ignoradas, ${resultado.totalRejeitadas} rejeitadas) em ${resultado.tempoMs}ms.`,
      );
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message.slice(0, 1000) : 'Falha desconhecida.';
      const permanente = erro instanceof EnvelopeValidationError || upload.tentativas >= 10;
      await this.prisma.uploadBackupPdv.update({
        where: { id: uploadId },
        data: { status: permanente ? 'quarentena' : 'recebido', erroDetalhe: detalhe },
      });
      this.logger.error(`Falha ao validar/extrair backup ${uploadId}: ${detalhe}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
