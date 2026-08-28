import { Injectable } from '@nestjs/common';
import type { DashboardQuery, DashboardResumo, DistribuicaoPagamento, FluxoCaixaDiario } from 'contracts';
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
}
