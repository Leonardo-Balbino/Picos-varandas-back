import { DashboardService } from './dashboard.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { FinanceiroService } from '../financeiro/financeiro.service';

function criarPrismaMock(vendas: Array<{ valorBruto: number; dataHora: Date }> = []) {
  return {
    vendaPdv: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(vendas)),
      count: jest.fn().mockResolvedValue(vendas.length),
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

describe('DashboardService (Dashboard Executivo 100% Real)', () => {
  it('quando o banco não tem vendas no dia, retorna faturamento 0 e rankings vazios sem inventar dados', async () => {
    const prisma = criarPrismaMock([]);
    const financeiro = criarFinanceiroMock();
    const service = new DashboardService(prisma, financeiro);

    const resultado = await service.resumoMobile({ data: '2026-09-15', periodo: 'hoje' });

    expect(resultado.dataReferencia).toBe('2026-09-15');
    expect(resultado.periodo).toBe('hoje');
    expect(resultado.kpis.faturamentoBruto).toBe(0);
    expect(resultado.kpis.totalPedidos).toBe(0);
    expect(resultado.kpis.ticketMedio).toBe(0);
    expect(resultado.kpis.lucroBrutoEstimado).toBe(0);
    expect(resultado.rankingGarcons).toEqual([]);
    expect(resultado.rankingProdutos.todos).toEqual([]);
  });

  it('quando o banco possui vendas reais, calcula faturamento bruto, ticket médio e margens reais', async () => {
    const vendasReais = [
      { valorBruto: 150.0, dataHora: new Date('2026-09-15T12:00:00-03:00') },
      { valorBruto: 250.0, dataHora: new Date('2026-09-15T13:30:00-03:00') },
    ];
    const prisma = criarPrismaMock(vendasReais);
    const financeiro = criarFinanceiroMock();
    const service = new DashboardService(prisma, financeiro);

    const resultado = await service.resumoMobile({ data: '2026-09-15', periodo: 'hoje' });

    expect(resultado.kpis.faturamentoBruto).toBe(400.0);
    expect(resultado.kpis.totalPedidos).toBe(2);
    expect(resultado.kpis.ticketMedio).toBe(200.0);
    expect(resultado.kpis.lucroBrutoEstimado).toBe(250.0); // 62.5% de 400
  });

  it('suporta períodos ontens, 7dias e mes', async () => {
    const prisma = criarPrismaMock([]);
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
    const prisma = criarPrismaMock([]);
    const financeiro = criarFinanceiroMock();
    const service = new DashboardService(prisma, financeiro);

    const resultado = await service.resumo({ anoMes: '2026-09' });

    expect(resultado.caixaLocal).toBe(1500);
    expect(resultado.faturamentoBruto).toBe(0);
    expect(Array.isArray(resultado.fluxoCaixaDiario)).toBe(true);
    expect(Array.isArray(resultado.distribuicaoPagamentos)).toBe(true);
  });
});
