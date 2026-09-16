import { BackupValidationWorker } from './backup-validation.worker';
import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { BackupBucketService } from '../../../infra/storage/backup-bucket.service';
import type { BackupExtractorService } from './backup-extractor.service';

interface MockPrisma {
  uploadBackupPdv: {
    updateMany: jest.Mock;
    findMany: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    update: jest.Mock;
  };
}

interface MockBucket {
  abrir: jest.Mock;
}

interface MockExtractor {
  extrairEIngerir: jest.Mock;
}

describe('BackupValidationWorker', () => {
  let worker: BackupValidationWorker;
  let mockPrisma: MockPrisma;
  let mockBucket: MockBucket;
  let mockExtractor: MockExtractor;

  beforeEach(() => {
    mockPrisma = {
      uploadBackupPdv: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mockBucket = {
      abrir: jest.fn(),
    };
    mockExtractor = {
      extrairEIngerir: jest.fn().mockResolvedValue({
        totalVendas: 100,
        totalCriadas: 100,
        totalAtualizadas: 0,
        totalIgnoradas: 0,
        totalRejeitadas: 0,
        tempoMs: 500,
      }),
    };

    worker = new BackupValidationWorker(
      mockPrisma as unknown as PrismaService,
      mockBucket as unknown as BackupBucketService,
      mockExtractor as unknown as BackupExtractorService,
    );
  });

  it('retoma uploads interrompidos e processa candidatos pendentes', async () => {
    mockPrisma.uploadBackupPdv.findMany.mockResolvedValue([
      { id: 'up-1' },
      { id: 'up-2' },
    ]);

    const spyValidar = jest
      .spyOn(worker as unknown as { validar: (id: string) => Promise<void> }, 'validar')
      .mockResolvedValue(undefined);

    const processados = await worker.processarPendentes();

    expect(processados).toBe(2);
    expect(mockPrisma.uploadBackupPdv.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'up-1', status: 'recebido' },
        data: expect.objectContaining({ status: 'processando' }),
      }),
    );
    expect(spyValidar).toHaveBeenCalledWith('up-1');
    expect(spyValidar).toHaveBeenCalledWith('up-2');
  });

  it('ignora candidato se outro worker já reivindicou (concorrência)', async () => {
    mockPrisma.uploadBackupPdv.findMany.mockResolvedValue([{ id: 'up-corrida' }]);
    mockPrisma.uploadBackupPdv.updateMany
      .mockResolvedValueOnce({ count: 0 }) // retomada de stale
      .mockResolvedValueOnce({ count: 0 }); // falha na corrida de claim

    const spyValidar = jest
      .spyOn(worker as unknown as { validar: (id: string) => Promise<void> }, 'validar')
      .mockResolvedValue(undefined);

    const processados = await worker.processarPendentes();

    expect(processados).toBe(0);
    expect(spyValidar).not.toHaveBeenCalled();
  });
});
