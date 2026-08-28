import { Injectable } from '@nestjs/common';
import type { DestrancarMesInput, FechamentoResposta } from 'contracts';
import { AppException } from '../../common/exceptions/app.exception';
import { money, toMoney } from '../../common/money';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { FechamentoMensal } from '../../generated/prisma/client';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  fechado: boolean;
  expiraEm: number;
}

/**
 * Fatia H2-infra (Card H2), antecipada para a Fase 1 do plano de hoje: só a
 * checagem de "este mês está trancado?", usada pelo PeriodoGuard desde o
 * primeiro endpoint de escrita de D/E/F/G. O CRUD completo de abrir/fechar
 * mês (H1 + resto de H2 — cálculo de saldo consolidado, sequencialidade,
 * justificativa de destrave) entra na Fase 4, quando todos os módulos que
 * ele consolida (conciliação, financeiro, caixa) já existirem.
 *
 * Cache em memória de 60s (seção do Card H2): consultar `fechamentos_mensais`
 * a cada escrita seria uma query extra em toda mutação da API. Com
 * `max-instances`/réplicas efetivamente 1 nesta topologia (Railway com
 * volume — ver Card A4), não existe o cenário de múltiplas instâncias
 * vendo caches desatualizados entre si; mesmo que houvesse, o documento
 * aceita explicitamente uma janela de até 60s de imprecisão nessa direção
 * (trancar/destrancar são operações raras e administrativas).
 */
@Injectable()
export class FechamentoService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /** @param competencia formato "AAAA-MM". */
  async isCompetenciaFechada(competencia: string): Promise<boolean> {
    const cacheado = this.cache.get(competencia);
    if (cacheado && cacheado.expiraEm > Date.now()) {
      return cacheado.fechado;
    }

    const { ano, mes } = this.parseCompetencia(competencia);
    const fechamento = await this.prisma.fechamentoMensal.findUnique({
      where: { ano_mes: { ano, mes } },
      select: { trancado: true },
    });
    const fechado = fechamento?.trancado ?? false;

    this.cache.set(competencia, { fechado, expiraEm: Date.now() + CACHE_TTL_MS });
    return fechado;
  }

  /** Chamado pelo CRUD de trancar/destrancar (Fase 4) depois de gravar a
   * mudança — sem isto, uma trava/destrava recém-feita só refletiria nas
   * próximas escritas depois de até 60s, o que é surpreendente para quem
   * acabou de clicar em "trancar" e esperaria efeito imediato. */
  invalidarCache(competencia: string): void {
    this.cache.delete(competencia);
  }

  private parseCompetencia(competencia: string): { ano: number; mes: number } {
    const [anoStr, mesStr] = competencia.split('-');
    return { ano: Number(anoStr), mes: Number(mesStr) };
  }

  // -------------------------------------------------------------------
  // CRUD de fechamento (H1) e trancar/destrancar (resto do H2) — Fase 4.
  // -------------------------------------------------------------------

  /** Grade anual (Card H1): garante que as 12 linhas do ano corrente
   * existam (upsert com zeros, sem sobrescrever quem já existe) e devolve
   * todas ordenadas. Mês DESTRANCADO tem os totais recalculados ao vivo a
   * partir dos lançamentos (nunca persistidos — só o trancar grava o
   * snapshot); mês TRANCADO devolve exatamente o que foi congelado (Card
   * H1: "o valor consolidado de um mês fechado não pode mudar
   * retroativamente"). */
  async listarFechamentos(): Promise<FechamentoResposta[]> {
    const ano = new Date().getUTCFullYear();
    await Promise.all(
      Array.from({ length: 12 }, (_, indice) => indice + 1).map((mes) =>
        this.prisma.fechamentoMensal.upsert({
          where: { ano_mes: { ano, mes } },
          update: {},
          create: { ano, mes },
        }),
      ),
    );

    const registros = await this.prisma.fechamentoMensal.findMany({
      where: { ano },
      include: { trancadoPor: { select: { nome: true } } },
      orderBy: { mes: 'asc' },
    });

    return Promise.all(
      registros.map(async (registro) => {
        if (registro.trancado) {
          return this.paraResposta(registro);
        }
        const { faturamentoTotal, despesasTotal } = await this.calcularTotaisAoVivo(registro.ano, registro.mes);
        return this.paraResposta({ ...registro, faturamentoTotal, despesasTotal, saldoFinal: faturamentoTotal.minus(despesasTotal) });
      }),
    );
  }

  async trancar(competencia: string, usuarioId: string): Promise<FechamentoResposta> {
    const { ano, mes } = this.parseCompetencia(competencia);
    const { faturamentoTotal, despesasTotal } = await this.calcularTotaisAoVivo(ano, mes);
    const saldoFinal = faturamentoTotal.minus(despesasTotal);

    const atualizado = await this.prisma.fechamentoMensal.upsert({
      where: { ano_mes: { ano, mes } },
      update: {
        faturamentoTotal,
        despesasTotal,
        saldoFinal,
        trancado: true,
        trancadoPorId: usuarioId,
        trancadoEm: new Date(),
      },
      create: {
        ano,
        mes,
        faturamentoTotal,
        despesasTotal,
        saldoFinal,
        trancado: true,
        trancadoPorId: usuarioId,
        trancadoEm: new Date(),
      },
      include: { trancadoPor: { select: { nome: true } } },
    });
    this.invalidarCache(competencia);
    return this.paraResposta(atualizado);
  }

  async destrancar(competencia: string, input: DestrancarMesInput): Promise<FechamentoResposta> {
    const { ano, mes } = this.parseCompetencia(competencia);
    const existente = await this.prisma.fechamentoMensal.findUnique({ where: { ano_mes: { ano, mes } } });
    if (!existente || !existente.trancado) {
      throw new AppException({ status: 409, code: 'CONFLICT', message: 'Este mês não está trancado.' });
    }

    const atualizado = await this.prisma.fechamentoMensal.update({
      where: { ano_mes: { ano, mes } },
      data: {
        trancado: false,
        trancadoPorId: null,
        trancadoEm: null,
        justificativaDestrave: input.justificativaDestrave,
      },
      include: { trancadoPor: { select: { nome: true } } },
    });
    this.invalidarCache(competencia);
    return this.paraResposta(atualizado);
  }

  /** Soma vendas do PDV (faturamento) e baixas de contas a pagar + sangrias
   * de caixa (despesas) dentro do mês. Despesa via caixa local não é somada
   * duas vezes: toda `despesa_caixa` nasce de uma baixa de conta a pagar
   * (ver FinanceiroService.pagarContaPagar), então só a baixa entra na
   * conta — só `sangria` (retirada sem título associado) soma à parte.
   *
   * SIMPLIFICAÇÃO conhecida: janela do mês usada em UTC direto para
   * `dataHora` (timestamptz), sem converter para o fuso da loja por linha —
   * mesma classe de tolerância já aceita em outros pontos do projeto (ex.:
   * cache de 60s do próprio `isCompetenciaFechada`). Só afeta o punhado de
   * transações muito perto da meia-noite BRT vs UTC (03:00 de diferença);
   * revisar se algum dia a precisão ao minuto importar aqui. */
  private async calcularTotaisAoVivo(
    ano: number,
    mes: number,
  ): Promise<{ faturamentoTotal: ReturnType<typeof money>; despesasTotal: ReturnType<typeof money> }> {
    const inicio = new Date(Date.UTC(ano, mes - 1, 1));
    const fim = new Date(Date.UTC(mes === 12 ? ano + 1 : ano, mes === 12 ? 0 : mes, 1));
    const inicioCivil = inicio.toISOString().slice(0, 10);
    const fimCivil = fim.toISOString().slice(0, 10);

    const [faturamento, contasPagas, sangrias] = await Promise.all([
      this.prisma.vendaPdv.aggregate({
        where: { dataHora: { gte: inicio, lt: fim } },
        _sum: { valorLiquido: true },
      }),
      this.prisma.contaPagar.aggregate({
        where: { status: 'pago', dataPagamento: { gte: new Date(inicioCivil), lt: new Date(fimCivil) } },
        _sum: { valor: true },
      }),
      this.prisma.movimentacaoCaixa.aggregate({
        where: { tipo: 'sangria', dataHora: { gte: inicio, lt: fim } },
        _sum: { valor: true },
      }),
    ]);

    const faturamentoTotal = money(faturamento._sum.valorLiquido ?? 0);
    const despesasTotal = money(contasPagas._sum.valor ?? 0).plus(money(sangrias._sum.valor ?? 0));
    return { faturamentoTotal, despesasTotal };
  }

  private paraResposta(
    fechamento: FechamentoMensal & { trancadoPor: { nome: string } | null },
  ): FechamentoResposta {
    return {
      id: fechamento.id,
      anoMes: `${fechamento.ano}-${String(fechamento.mes).padStart(2, '0')}`,
      trancado: fechamento.trancado,
      trancadoEm: fechamento.trancadoEm ? fechamento.trancadoEm.toISOString() : null,
      trancadoPorNome: fechamento.trancadoPor?.nome ?? null,
      faturamentoTotal: toMoney(money(fechamento.faturamentoTotal)) as number,
      despesasTotal: toMoney(money(fechamento.despesasTotal)) as number,
      saldoFinal: toMoney(money(fechamento.saldoFinal)) as number,
    };
  }
}
