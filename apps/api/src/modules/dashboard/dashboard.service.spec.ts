import { DashboardService } from './dashboard.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { FinanceiroService } from '../financeiro/financeiro.service';

function criarPrismaMock() {
  return {
    vendaPdv: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    contaPagar: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { valor: 0 } }),
    },
    contaReceber: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { valorBruto: 0 } }),
    },
    movimentacaoCaixa: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    conciliacao: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { valorTaxaGateway: 0 } }),
    },
  } as unknown as PrismaService;
}

function criarFinanceiroMock() {
  return {
    saldoCaixa: jest.fn().mockResolvedValue({ saldo: 1500 }),
  } as unknown as FinanceiroService;
}

describe('DashboardService (Dashboard Executivo Mobile + Desktop)', () => {
  it('retorna o resumo mobile com estrutura completa de KPIs, benchmarking e rankings', async () => {
    const prisma = criarPrismaMock();
    const financeiro = criarFinanceiroMock();
    const service = new DashboardService(prisma, financeiro);

    const resultado = await service.resumoMobile({ data: '2026-09-15', periodo: 'hoje' });

    expect(resultado.dataReferencia).toBe('2026-09-15');
    expect(resultado.periodo).toBe('hoje');
    expect(resultado.kpis.faturamentoBruto).toBeGreaterThan(0);
    expect(resultado.kpis.lucroBrutoEstimado).toBeGreaterThan(0);
    expect(resultado.kpis.ticketMedio).toBeGreaterThan(0);
    expect(resultado.kpis.benchmarking.mediaHistorica8Semanas).toBeGreaterThan(0);
    expect(resultado.kpis.benchmarking.metaDoDia).toBeGreaterThan(0);
    expect(resultado.rankingGarcons.length).toBeGreaterThanOrEqual(5);
    expect(resultado.rankingProdutos.bebidas.length).toBeGreaterThanOrEqual(5);
    expect(resultado.rankingProdutos.cozinha.length).toBeGreaterThanOrEqual(5);
    expect(resultado.rankingProdutos.todos.length).toBeGreaterThanOrEqual(10);
  });

  it('suporta períodos ontens, 7dias e mes', async () => {
    const prisma = criarPrismaMock();
    const financeiro = criarFinanceiroMock();
    const service = new DashboardService(prisma, financeiro);

    const resultado7dias = await service.resumoMobile({ data: '2026-09-15', periodo: '7dias' });
    expect(resultado7dias.diaDaSemanaTexto).toBe('Últimos 7 dias');
    expect(resultado7dias.periodo).toBe('7dias');

    const resultadoMes = await service.resumoMobile({ data: '2026-09-15', periodo: 'mes' });
    expect(resultadoMes.diaDaSemanaTexto).toContain('Mês Atual');
    expect(resultadoMes.periodo).toBe('mes');
  });

  it('retorna o resumo contábil desktop para o mês solicitado', async () => {
    const prisma = criarPrismaMock();
    const financeiro = criarFinanceiroMock();
    const service = new DashboardService(prisma, financeiro);

    const resultado = await service.resumo({ anoMes: '2026-09' });

    expect(resultado.caixaLocal).toBe(1500);
    expect(resultado.faturamentoBruto).toBe(0);
    expect(Array.isArray(resultado.fluxoCaixaDiario)).toBe(true);
    expect(Array.isArray(resultado.distribuicaoPagamentos)).toBe(true);
  });
});
