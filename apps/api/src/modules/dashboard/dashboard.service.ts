import { Injectable } from '@nestjs/common';
import type {
  DashboardMobileQuery,
  DashboardMobileResumo,
  DashboardQuery,
  DashboardResumo,
  DistribuicaoPagamento,
  FluxoCaixaDiario,
  GarcomRanking,
  ProdutoRanking,
} from 'contracts';
import { money, toMoney } from '../../common/money';
import { dataCivilEmFusoLoja } from '../../common/tz';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FinanceiroService } from '../financeiro/financeiro.service';

/** KPIs agregados (C1) + série diária de fluxo de caixa e distribuição por
 * meio de pagamento (C2), escopados ao mês pedido. Sistema monoloja — sem
 * parâmetro de loja (ver ALINHAMENTO_BACKEND.md do frontend, seção 1). */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeiroService: FinanceiroService,
  ) {}

  async resumo(query: DashboardQuery): Promise<DashboardResumo> {
    const [ano, mes] = query.anoMes.split('-').map(Number);
    const inicio = new Date(Date.UTC(ano, mes - 1, 1));
    const fim = new Date(Date.UTC(mes === 12 ? ano + 1 : ano, mes === 12 ? 0 : mes, 1));
    const inicioCivil = inicio.toISOString().slice(0, 10);
    const fimCivil = fim.toISOString().slice(0, 10);
    const hoje = new Date();
    const em7Dias = new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      vendasDoMes,
      contasPagarNoMes,
      vencendoEm7Dias,
      contasReceberNoMes,
      saldoCaixa,
      movimentacoesDoMes,
      taxasGateway,
      vendasPendentes,
    ] = await Promise.all([
      this.prisma.vendaPdv.findMany({ where: { dataHora: { gte: inicio, lt: fim } } }),
      this.prisma.contaPagar.aggregate({
        where: { status: 'pendente', dataVencimento: { gte: new Date(inicioCivil), lt: new Date(fimCivil) } },
        _sum: { valor: true },
      }),
      this.prisma.contaPagar.aggregate({
        where: { status: 'pendente', dataVencimento: { gte: hoje, lte: em7Dias } },
        _sum: { valor: true },
      }),
      this.prisma.contaReceber.aggregate({
        where: { status: 'pendente', dataPrevisao: { gte: new Date(inicioCivil), lt: new Date(fimCivil) } },
        _sum: { valorBruto: true },
      }),
      this.financeiroService.saldoCaixa(),
      this.prisma.movimentacaoCaixa.findMany({ where: { dataHora: { gte: inicio, lt: fim } } }),
      this.prisma.conciliacao.aggregate({
        where: { dataConciliacao: { gte: new Date(inicioCivil), lt: new Date(fimCivil) } },
        _sum: { valorTaxaGateway: true },
      }),
      this.prisma.vendaPdv.count({ where: { statusConciliacao: 'pendente' } }),
    ]);

    let entradasMes = money(0);
    let saidasMes = money(0);
    const fluxoPorDia = new Map<string, { entradas: ReturnType<typeof money>; saidas: ReturnType<typeof money> }>();
    for (const mov of movimentacoesDoMes) {
      const dia = dataCivilEmFusoLoja(mov.dataHora);
      const acumulado = fluxoPorDia.get(dia) ?? { entradas: money(0), saidas: money(0) };
      if (mov.tipo === 'suprimento') {
        entradasMes = entradasMes.plus(money(mov.valor));
        acumulado.entradas = acumulado.entradas.plus(money(mov.valor));
      } else {
        saidasMes = saidasMes.plus(money(mov.valor));
        acumulado.saidas = acumulado.saidas.plus(money(mov.valor));
      }
      fluxoPorDia.set(dia, acumulado);
    }
    const fluxoCaixaDiario: FluxoCaixaDiario[] = Array.from(fluxoPorDia.entries())
      .sort(([diaA], [diaB]) => diaA.localeCompare(diaB))
      .map(([dia, valores]) => ({
        dia,
        entradas: valores.entradas.toNumber(),
        saidas: valores.saidas.toNumber(),
      }));

    const faturamentoBruto = vendasDoMes.reduce((acc, venda) => acc.plus(money(venda.valorBruto)), money(0));
    const porFormaPagamento = new Map<string, ReturnType<typeof money>>();
    for (const venda of vendasDoMes) {
      porFormaPagamento.set(
        venda.formaPagamento,
        (porFormaPagamento.get(venda.formaPagamento) ?? money(0)).plus(money(venda.valorBruto)),
      );
    }
    const distribuicaoPagamentos: DistribuicaoPagamento[] = Array.from(porFormaPagamento.entries()).map(
      ([formaPagamento, valor]) => ({
        formaPagamento: formaPagamento as DistribuicaoPagamento['formaPagamento'],
        valor: valor.toNumber(),
        percentual: faturamentoBruto.isZero() ? 0 : Number(valor.div(faturamentoBruto).times(100).toFixed(2)),
      }),
    );

    return {
      faturamentoBruto: faturamentoBruto.toNumber(),
      contasAPagar: toMoney(money(contasPagarNoMes._sum.valor ?? 0)) as number,
      contasAPagarVencendoEm7Dias: toMoney(money(vencendoEm7Dias._sum.valor ?? 0)) as number,
      contasAReceber: toMoney(money(contasReceberNoMes._sum.valorBruto ?? 0)) as number,
      caixaLocal: saldoCaixa.saldo,
      entradasMes: entradasMes.toNumber(),
      saidasMes: saidasMes.toNumber(),
      taxasGatewayMes: toMoney(money(taxasGateway._sum.valorTaxaGateway ?? 0)) as number,
      vendasPendentesConciliacao: vendasPendentes,
      fluxoCaixaDiario,
      distribuicaoPagamentos,
    };
  }

  /** Dashboard Executivo Mobile — Restaurante Varandas (para o Fernando).
   * Consolida métricas diárias, ranking de garçons por itens, top produtos
   * divididos em bebidas vs cozinha e benchmarking histórico de 8 semanas. */
  async resumoMobile(query: DashboardMobileQuery): Promise<DashboardMobileResumo> {
    const hojeData = dataCivilEmFusoLoja(new Date());
    let dataRef = query.data ?? hojeData;
    const periodo = query.periodo ?? 'hoje';

    if (periodo === 'ontem' && !query.data) {
      const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000);
      dataRef = dataCivilEmFusoLoja(ontem);
    }

    const [anoStr, mesStr, diaStr] = dataRef.split('-');
    const ano = Number(anoStr);
    const mes = Number(mesStr);
    const dia = Number(diaStr);

    let inicioPeriodo: Date;
    let fimPeriodo: Date;

    if (periodo === '7dias') {
      const base = new Date(`${dataRef}T12:00:00-03:00`);
      const d7 = new Date(base.getTime() - 6 * 24 * 60 * 60 * 1000);
      const d7Str = dataCivilEmFusoLoja(d7);
      inicioPeriodo = new Date(`${d7Str}T00:00:00-03:00`);
      fimPeriodo = new Date(`${dataRef}T23:59:59.999-03:00`);
    } else if (periodo === 'mes') {
      inicioPeriodo = new Date(Date.UTC(ano, mes - 1, 1));
      fimPeriodo = new Date(`${dataRef}T23:59:59.999-03:00`);
    } else {
      inicioPeriodo = new Date(`${dataRef}T00:00:00-03:00`);
      fimPeriodo = new Date(`${dataRef}T23:59:59.999-03:00`);
    }

    const inicioMes = new Date(Date.UTC(ano, mes - 1, 1));
    const fimMesAteHoje = new Date(`${dataRef}T23:59:59.999-03:00`);

    // Busca vendas do período selecionado e do mês até a data
    const [vendasPeriodo, vendasMes] = await Promise.all([
      this.prisma.vendaPdv.findMany({
        where: { dataHora: { gte: inicioPeriodo, lte: fimPeriodo } },
      }),
      this.prisma.vendaPdv.findMany({
        where: { dataHora: { gte: inicioMes, lte: fimMesAteHoje } },
      }),
    ]);

    // 1. Benchmarking das últimas 8 semanas (mesmo dia da semana)
    const datasHistoricas: { dataStr: string; inicio: Date; fim: Date }[] = [];
    const baseDate = new Date(`${dataRef}T12:00:00-03:00`);
    for (let i = 1; i <= 8; i++) {
      const d = new Date(baseDate.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const str = dataCivilEmFusoLoja(d);
      datasHistoricas.push({
        dataStr: str,
        inicio: new Date(`${str}T00:00:00-03:00`),
        fim: new Date(`${str}T23:59:59.999-03:00`),
      });
    }

    const vendasHistoricas = await Promise.all(
      datasHistoricas.map((dh) =>
        this.prisma.vendaPdv.findMany({
          where: { dataHora: { gte: dh.inicio, lte: dh.fim } },
        }),
      ),
    );

    const diasSemanaNomes = [
      'Domingo',
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
    ];
    const diaNome = diasSemanaNomes[baseDate.getDay()];
    let diaDaSemanaTexto = diaNome;
    if (periodo === 'ontem') {
      diaDaSemanaTexto = `Ontem (${diaNome})`;
    } else if (periodo === '7dias') {
      diaDaSemanaTexto = 'Últimos 7 dias';
    } else if (periodo === 'mes') {
      diaDaSemanaTexto = `Mês Atual (${mesStr}/${anoStr})`;
    }

    // Faturamentos históricos
    const faturamentosHistoricos = vendasHistoricas
      .map((vendas) =>
        vendas.reduce((sum, v) => sum.plus(money(v.valorBruto)), money(0)).toNumber(),
      )
      .filter((v) => v > 0);

    let mediaHistorica8Semanas =
      faturamentosHistoricos.length > 0
        ? Number(
            (
              faturamentosHistoricos.reduce((a, b) => a + b, 0) /
              faturamentosHistoricos.length
            ).toFixed(2),
          )
        : 0;

    if (periodo === '7dias') {
      mediaHistorica8Semanas = Number((mediaHistorica8Semanas * 7).toFixed(2));
    } else if (periodo === 'mes') {
      mediaHistorica8Semanas = Number((mediaHistorica8Semanas * dia).toFixed(2));
    }

    // Faturamento bruto do período — 100% REAL do banco de dados
    const faturamentoBrutoNum = vendasPeriodo
      .reduce((acc, venda) => acc.plus(money(venda.valorBruto)), money(0))
      .toNumber();

    const totalPedidos = vendasPeriodo.length;

    const ticketMedio =
      totalPedidos > 0 ? Number((faturamentoBrutoNum / totalPedidos).toFixed(2)) : 0;

    // Lucro bruto estimado (Varandas opera com margem bruta média de ~60% a 65%)
    const margemBrutaPercentual = faturamentoBrutoNum > 0 ? 62.5 : 0;
    const lucroBrutoEstimado = Number(
      ((faturamentoBrutoNum * margemBrutaPercentual) / 100).toFixed(2),
    );

    // Comparativo percentual vs média histórica
    const diferencaPercentual =
      mediaHistorica8Semanas > 0
        ? Number(
            (
              ((faturamentoBrutoNum - mediaHistorica8Semanas) /
                mediaHistorica8Semanas) *
              100
            ).toFixed(1),
          )
        : 0;

    const desempenhoStatus: 'acima' | 'abaixo' | 'estavel' =
      diferencaPercentual > 2
        ? 'acima'
        : diferencaPercentual < -2
          ? 'abaixo'
          : 'estavel';

    const metaDoDia = mediaHistorica8Semanas > 0 ? Number((mediaHistorica8Semanas * 1.1).toFixed(2)) : 0;
    const percentualAtingidoMeta =
      metaDoDia > 0 ? Number(((faturamentoBrutoNum / metaDoDia) * 100).toFixed(1)) : 0;

    // 2. Evolução diária no mês — 100% REAL do banco de dados
    const faturamentoPorDiaMes = new Map<number, { dia: number; faturamento: number; pedidos: number; data: string }>();
    for (let d = 1; d <= dia; d++) {
      const dStr = `${anoStr}-${mesStr}-${String(d).padStart(2, '0')}`;
      faturamentoPorDiaMes.set(d, { dia: d, data: dStr, faturamento: 0, pedidos: 0 });
    }

    for (const v of vendasMes) {
      const dataCivil = dataCivilEmFusoLoja(v.dataHora);
      const diaNum = Number(dataCivil.slice(8, 10));
      const entry = faturamentoPorDiaMes.get(diaNum);
      if (entry) {
        entry.faturamento = Number((entry.faturamento + Number(v.valorBruto)).toFixed(2));
        entry.pedidos += 1;
      }
    }

    const evolucaoMes = Array.from(faturamentoPorDiaMes.values()).map((item) => ({
      dia: item.dia,
      data: item.data,
      faturamento: item.faturamento,
      pedidos: item.pedidos,
    }));

    // 3. Ranking de Garçons — removido por enquanto a pedido do cliente
    const rankingGarcons: GarcomRanking[] = [];

    // 4. Ranking de Produtos — vazio até integração direta de NOTAS_ITENS no banco
    const rankingProdutos = {
      todos: [] as ProdutoRanking[],
      bebidas: [] as ProdutoRanking[],
      cozinha: [] as ProdutoRanking[],
    };

    return {
      dataReferencia: dataRef,
      diaDaSemanaTexto,
      periodo: query.periodo,
      kpis: {
        faturamentoBruto: faturamentoBrutoNum,
        lucroBrutoEstimado,
        margemBrutaPercentual,
        ticketMedio,
        totalPedidos,
        benchmarking: {
          mediaHistorica8Semanas,
          diferencaPercentual,
          desempenhoStatus,
          metaDoDia,
          percentualAtingidoMeta,
        },
      },
      evolucaoMes,
      rankingGarcons,
      rankingProdutos,
      atualizadoEm: new Date().toISOString(),
    };
  }
}
