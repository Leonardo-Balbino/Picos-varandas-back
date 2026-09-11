import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { BackupBucketService } from '../../../infra/storage/backup-bucket.service';
import { BackupUploadService } from './backup-upload.service';

const upload = {
  id: 'upload-1',
  agenteId: 'agente-1',
  chaveIdempotencia: 'idem-1',
  nomeOrigem: 'backup.zip',
  tamanhoOrigem: 10n,
  sha256Origem: 'a'.repeat(64),
  mtimeOrigemNs: '123',
  formatoEnvelope: 'PVAENC01',
  tamanhoEnvelope: 8n * 1024n * 1024n,
  sha256Envelope: 'b'.repeat(64),
  chaveObjeto: 'backups/hash/id.pva',
  multipartUploadId: 'multipart-1',
  proximoOffset: 0n,
  status: 'enviando',
  erroDetalhe: null,
  tentativas: 0,
  recebidoEm: null,
  validadoEm: null,
  criadoEm: new Date(),
  atualizadoEm: new Date(),
};

describe('BackupUploadService', () => {
  it('recusa parte intermediária menor que o mínimo S3', async () => {
    const prisma = {
      uploadBackupPdv: { findFirst: jest.fn().mockResolvedValue(upload) },
    } as unknown as PrismaService;
    const bucket = {} as BackupBucketService;
    const service = new BackupUploadService(prisma, bucket);
    await expect(
      service.prepararParte('agente-1', 'upload-1', {
        partNumber: 1,
        offset: 0,
        size: 1024,
        sha256: 'c'.repeat(64),
      }),
    ).rejects.toThrow(/5 MiB/);
  });

  it('nunca entrega sessão pertencente a outro agente', async () => {
    const prisma = {
      uploadBackupPdv: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const service = new BackupUploadService(prisma, {} as BackupBucketService);
    await expect(service.status('agente-2', 'upload-1')).rejects.toThrow(/não encontrado/);
    expect(prisma.uploadBackupPdv.findFirst).toHaveBeenCalledWith({
      where: { id: 'upload-1', agenteId: 'agente-2' },
    });
  });

  it('só muda para verifying depois de concluir e conferir o tamanho no bucket', async () => {
    const completo = { ...upload, proximoOffset: upload.tamanhoEnvelope };
    const prisma = {
      uploadBackupPdv: {
        findFirst: jest.fn().mockResolvedValue(completo),
        update: jest.fn().mockResolvedValue({}),
      },
      parteUploadBackupPdv: {
        findMany: jest.fn().mockResolvedValue([
          { numeroParte: 1, etag: '"etag"' },
        ]),
      },
    } as unknown as PrismaService;
    const bucket = {
      concluir: jest.fn().mockResolvedValue(undefined),
      tamanho: jest.fn().mockResolvedValue(Number(upload.tamanhoEnvelope)),
    } as unknown as BackupBucketService;
    const service = new BackupUploadService(prisma, bucket);
    await expect(
      service.concluir('agente-1', 'upload-1', {
        encryptedSize: Number(upload.tamanhoEnvelope),
        encryptedSha256: upload.sha256Envelope,
      }),
    ).resolves.toEqual({ status: 'verifying' });
    expect(prisma.uploadBackupPdv.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'recebido' }) }),
    );
  });

  it('não aceita como concluído um objeto de tamanho divergente', async () => {
    const completo = { ...upload, proximoOffset: upload.tamanhoEnvelope };
    const prisma = {
      uploadBackupPdv: {
        findFirst: jest.fn().mockResolvedValue(completo),
        update: jest.fn().mockResolvedValue({}),
      },
      parteUploadBackupPdv: {
        findMany: jest.fn().mockResolvedValue([{ numeroParte: 1, etag: '"etag"' }]),
      },
    } as unknown as PrismaService;
    const bucket = {
      concluir: jest.fn().mockResolvedValue(undefined),
      tamanho: jest.fn().mockResolvedValue(1),
    } as unknown as BackupBucketService;
    const service = new BackupUploadService(prisma, bucket);
    await expect(
      service.concluir('agente-1', 'upload-1', {
        encryptedSize: Number(upload.tamanhoEnvelope),
        encryptedSha256: upload.sha256Envelope,
      }),
    ).rejects.toThrow(/tamanho divergente/);
    expect(prisma.uploadBackupPdv.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'quarentena' }) }),
    );
  });
});
