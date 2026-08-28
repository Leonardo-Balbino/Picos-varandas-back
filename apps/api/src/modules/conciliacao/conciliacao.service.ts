import { Injectable } from '@nestjs/common';
import type {
  ContaBancariaResposta,
  ExtratoItemResposta,
  ExtratoListaResposta,
  ListaConciliacaoQuery,
  MatchAutoResponse,
  VendaPdvItemResposta,
  VendaPdvListaResposta,
  VincularConciliacaoInput,
  VincularConciliacaoResponse,
} from 'contracts';
import type { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { money, toMoney } from '../../common/money';
import { dataCivilEmFusoLoja } from '../../common/tz';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FechamentoService } from '../fechamento/fechamento.service';
import type { ExtratoBancario, TipoConciliacao, VendaPdv } from '../../generated/prisma/client';

/** Tolerância de casamento do match automático (Card D4) — mesma regra do
 * mock antigo do frontend que este módulo substitui: diferença de até
 * meio centavo entre valor do extrato e valor líquido da venda. */
const TOLERANCIA_MATCH = 0.005;

/** Leitura (D2), vínculo manual (D3) e match automático (D4) de conciliação
 * bancária. Import/parse do arquivo (D1) fica em extratos/ — módulo
 * separado por já existir antes desta sessão. */
@Injectable()
export class ConciliacaoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fechamentoService: FechamentoService,
  ) {}

  async listarExtrato(query: ListaConciliacaoQuery): Promise<ExtratoListaResposta> {
    const { page, pageSize, status, banco, conta, busca } = query;
    const where: Prisma.ExtratoBancarioWhereInput = {
      statusConciliacao: status,
      banco,
      conta,
      descricaoOrigem: busca ? { contains: busca, mode: 'insensitive' } : undefined,
    };
    const [registros, total] = await Promise.all([
      this.prisma.extratoBancario.findMany({
        where,
        orderBy: { dataTransacao: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.extratoBancario.count({ where }),
    ]);

    return {
      data: registros.map((registro) => this.extratoParaResposta(registro)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /** Combinações banco/conta já usadas em algum extrato importado, para o seletor de conta da
   * tela (Card D2) — sem isso o frontend teria que adivinhar/hardcodar os bancos existentes. */
  async listarContasBancarias(): Promise<ContaBancariaResposta[]> {
    const grupos = await this.prisma.extratoBancario.groupBy({
      by: ['banco', 'conta'],
      _count: { _all: true },
      where: { statusConciliacao: 'pendente' },
      orderBy: [{ banco: 'asc' }, { conta: 'asc' }],
    });
    return grupos.map((grupo) => ({ banco: grupo.banco, conta: grupo.conta, totalPendentes: grupo._count._all }));
  }

  async listarVendasPdv(query: ListaConciliacaoQuery): Promise<VendaPdvListaResposta> {
    const { page, pageSize, status, busca } = query;
    const where: Prisma.VendaPdvWhereInput = {
      statusConciliacao: status,
      numeroCupom: busca ? { contains: busca, mode: 'insensitive' } : undefined,
    };
    const [registros, total] = await Promise.all([
      this.prisma.vendaPdv.findMany({
        where,
        orderBy: { dataHora: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.vendaPdv.count({ where }),
    ]);

    return {
      data: registros.map((registro) => this.vendaPdvParaResposta(registro)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  /** Vínculo N:M de verdade (Card D3) — todo id de cada lado entra na mesma
   * `Conciliacao`, diferente do mock antigo do frontend que só cruzava o
   * primeiro id de cada array (ver PENDENCIAS_BACKEND.md do frontend). */
  async vincular(
    input: VincularConciliacaoInput,
    usuarioId: string,
    tipoConciliacao: TipoConciliacao = 'manual',
  ): Promise<VincularConciliacaoResponse> {
    const competenciaHoje = dataCivilEmFusoLoja(new Date()).slice(0, 7);
    if (await this.fechamentoService.isCompetenciaFechada(competenciaHoje)) {
      throw new AppException({
        status: 422,
        code: 'PERIOD_LOCKED',
        message: 'Este mês está trancado para auditoria. Contate o administrador.',
        fields: { competencia: competenciaHoje },
      });
    }

    return this.prisma.$transaction(
      async (tx) => {
        const extratos = await tx.extratoBancario.findMany({ where: { id: { in: input.extratoIds } } });
        const vendas = await tx.vendaPdv.findMany({ where: { id: { in: input.vendaPdvIds } } });

        if (extratos.length !== input.extratoIds.length || vendas.length !== input.vendaPdvIds.length) {
          throw new AppException({
            status: 404,
            code: 'NOT_FOUND',
            message: 'Um ou mais lançamentos selecionados não foram encontrados.',
          });
        }

        const jaVinculado = [...extratos, ...vendas].find((item) => item.statusConciliacao !== 'pendente');
        if (jaVinculado) {
          throw new AppException({
            status: 409,
            code: 'CONFLICT',
            message: 'Um ou mais itens selecionados já não estão mais pendentes.',
          });
        }

        const valorExtrato = extratos.reduce((acc, item) => acc.plus(money(item.valor)), money(0));
        const valorPdv = vendas.reduce((acc, item) => acc.plus(money(item.valorLiquido)), money(0));
        const diferencaAjuste = valorExtrato.minus(valorPdv);

        const conciliacao = await tx.conciliacao.create({
          data: {
            dataConciliacao: new Date(dataCivilEmFusoLoja(new Date())),
            valorExtrato,
            valorPdv,
            diferencaAjuste,
            tipoConciliacao,
            usuarioId,
            observacao: input.observacao,
          },
        });

        await tx.conciliacaoExtrato.createMany({
          data: input.extratoIds.map((extratoId) => ({ conciliacaoId: conciliacao.id, extratoId })),
        });
        await tx.conciliacaoItemVenda.createMany({
          data: input.vendaPdvIds.map((vendaPdvId) => ({ conciliacaoId: conciliacao.id, vendaPdvId })),
        });
        await tx.extratoBancario.updateMany({
          where: { id: { in: input.extratoIds } },
          data: { statusConciliacao: 'conciliado' },
        });
        await tx.vendaPdv.updateMany({
          where: { id: { in: input.vendaPdvIds } },
          data: { statusConciliacao: 'conciliado' },
        });

        return {
          conciliacaoId: conciliacao.id,
          valorExtrato: toMoney(valorExtrato) as number,
          valorPdv: toMoney(valorPdv) as number,
          diferencaAjuste: toMoney(diferencaAjuste) as number,
        };
      },
      { timeout: 30_000 },
    );
  }

  /** Casa 1:1 por proximidade de valor (Card D4) — extrato e venda PDV ambos
   * pendentes, |valor extrato - valor líquido venda| dentro da tolerância.
   * Motor simples de propósito (mesma regra do mock que substitui); um
   * motor por janela D+N/bandeira via taxas_gateway fica para quando o
   * volume real justificar a complexidade. */
  async matchAutomatico(usuarioId: string): Promise<MatchAutoResponse> {
    const [vendasPendentes, extratosPendentes] = await Promise.all([
      this.prisma.vendaPdv.findMany({ where: { statusConciliacao: 'pendente' } }),
      this.prisma.extratoBancario.findMany({ where: { statusConciliacao: 'pendente' } }),
    ]);

    const extratosDisponiveis = [...extratosPendentes];
    let vinculados = 0;

    for (const venda of vendasPendentes) {
      const valorVenda = money(venda.valorLiquido).toNumber();
      const indice = extratosDisponiveis.findIndex(
        (extrato) => Math.abs(money(extrato.valor).toNumber() - valorVenda) < TOLERANCIA_MATCH,
      );
      if (indice === -1) continue;

      const [extrato] = extratosDisponiveis.splice(indice, 1);
      await this.vincular({ extratoIds: [extrato.id], vendaPdvIds: [venda.id] }, usuarioId, 'automatica');
      vinculados++;
    }

    return { vinculados };
  }

  private extratoParaResposta(extrato: ExtratoBancario): ExtratoItemResposta {
    return {
      id: extrato.id,
      banco: extrato.banco,
      conta: extrato.conta,
      dataTransacao: extrato.dataTransacao.toISOString().slice(0, 10),
      descricaoOrigem: extrato.descricaoOrigem,
      documento: extrato.documento,
      tipoTransacao: extrato.tipoTransacao,
      valor: toMoney(extrato.valor) as number,
      categoria: extrato.categoria,
      statusConciliacao: extrato.statusConciliacao,
    };
  }

  private vendaPdvParaResposta(venda: VendaPdv): VendaPdvItemResposta {
    return {
      id: venda.id,
      numeroCupom: venda.numeroCupom,
      dataHora: venda.dataHora.toISOString(),
      formaPagamento: venda.formaPagamento,
      bandeira: venda.bandeira,
      valorBruto: toMoney(venda.valorBruto) as number,
      valorDesconto: toMoney(venda.valorDesconto) as number,
      valorLiquido: toMoney(venda.valorLiquido) as number,
      statusConciliacao: venda.statusConciliacao,
    };
  }
}
