import type { PrismaService } from '../../../infra/prisma/prisma.service';
import type { FechamentoService } from '../../fechamento/fechamento.service';
import { VendasSyncService } from './vendas-sync.service';

describe('VendasSyncService - cancelamento', () => {
  it('remove da nuvem uma transação pendente cancelada no ERP', async () => {
    const tx = {
      vendaPdv: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', statusConciliacao: 'pendente' }),
        delete: jest.fn().mockResolvedValue({}),
        create: jest.fn(),
        update: jest.fn(),
      },
      agenteSyncLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    } as unknown as PrismaService;
    const fechamento = {
      isCompetenciaFechada: jest.fn().mockResolvedValue(false),
    } as unknown as FechamentoService;
    const service = new VendasSyncService(prisma, fechamento);

    const result = await service.ingerir({
      loteId: 'l1',
      parteAtual: 1,
      totalPartes: 1,
      vendas: [{
        idExterno: 'erp-1',
        numeroCupom: '10',
        dataHora: '2026-09-08T12:00:00.000Z',
        valorBruto: 42.5,
        valorLiquido: 42.5,
        formaPagamento: 'pix',
        cancelada: true,
      }],
    });

    expect(tx.vendaPdv.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
    expect(tx.vendaPdv.create).not.toHaveBeenCalled();
    expect(tx.vendaPdv.update).not.toHaveBeenCalled();
    expect(result.atualizadas).toBe(1);
    expect(result.rejeitadas).toEqual([]);
  });

  it('rejeita cancelamento posterior sem apagar conciliação concluída', async () => {
    const tx = {
      vendaPdv: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', statusConciliacao: 'conciliado' }),
        delete: jest.fn(), create: jest.fn(), update: jest.fn(),
      },
      agenteSyncLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    } as unknown as PrismaService;
    const fechamento = {
      isCompetenciaFechada: jest.fn().mockResolvedValue(false),
    } as unknown as FechamentoService;
    const service = new VendasSyncService(prisma, fechamento);
    const result = await service.ingerir({
      loteId: 'l2', parteAtual: 1, totalPartes: 1,
      vendas: [{
        idExterno: 'erp-2', numeroCupom: '11', dataHora: '2026-09-08T12:00:00.000Z',
        valorBruto: 30, valorLiquido: 30, formaPagamento: 'pix', cancelada: true,
      }],
    });

    expect(tx.vendaPdv.delete).not.toHaveBeenCalled();
    expect(result.rejeitadas[0]?.motivo).toBe('CANCELLED_AFTER_RECONCILIATION');
  });
});
