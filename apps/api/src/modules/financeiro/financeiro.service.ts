import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  AtualizarContaPagarInput,
  ContaPagarListaResposta,
  ContaPagarResposta,
  ContaReceberListaResposta,
  CriarContaPagarInput,
  CriarMovimentacaoCaixaInput,
  ListaContasPagarQuery,
  ListaContasReceberQuery,
  ListaMovimentacoesCaixaQuery,
  MovimentacaoCaixaListaResposta,
  MovimentacaoCaixaResposta,
  PagarContaPagarInput,
  SaldoCaixaResposta,
  SituacaoContaPagar,
} from 'contracts';
import { AppException } from '../../common/exceptions/app.exception';
import { dataCivilEmFusoLoja } from '../../common/tz';
import { toMoney } from '../../common/money';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FechamentoService } from '../fechamento/fechamento.service';
import type { ContaPagar, ContaReceber, MovimentacaoCaixa } from '../../generated/prisma/client';

type ContaPagarComCriador = ContaPagar & { criadoPor: { nome: string } };

/** Contas a pagar (E1/E2), contas a receber (F1) e caixa físico (G1). */
@Injectable()
export class FinanceiroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fechamentoService: FechamentoService,
  ) {}

  // -------------------------------------------------------------------
  // Contas a pagar
  // -------------------------------------------------------------------

  async listarContasPagar(query: ListaContasPagarQuery): Promise<ContaPagarListaResposta> {
    const { page, pageSize, status } = query;
    const where = status ? { status } : {};
    const [registros, total] = await Promise.all([
      this.prisma.contaPagar.findMany({
        where,
        include: { criadoPor: { select: { nome: true } } },
        orderBy: { dataVencimento: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contaPagar.count({ where }),
    ]);

    return {
      data: registros.map((registro) => this.contaPagarParaResposta(registro)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async criarContaPagar(input: CriarContaPagarInput, criadoPorId: string): Promise<ContaPagarResposta> {
    const codigo = await this.proximoCodigo('contaPagar', 'CP');
    const criada = await this.prisma.contaPagar.create({
      data: {
        codigo,
        fornecedor: input.fornecedor,
        categoria: input.categoria,
        valor: input.valor,
        dataVencimento: new Date(input.dataVencimento),
        observacao: input.observacao,
        criadoPorId,
      },
      include: { criadoPor: { select: { nome: true } } },
    });
    return this.contaPagarParaResposta(criada);
  }

  async atualizarContaPagar(id: string, input: AtualizarContaPagarInput): Promise<ContaPagarResposta> {
    const atual = await this.buscarContaPagarOuFalhar(id);
    if (atual.status !== 'pendente') {
      throw new AppException({
        status: 409,
        code: 'CONFLICT',
        message: 'Só é possível editar uma conta a pagar pendente.',
      });
    }

    // dataVencimento pode não vir no corpo (edição de outro campo) — nesse
    // caso o @CompetenciaFrom do controller não tem o que checar; o mês do
    // vencimento ATUAL do registro precisa ser conferido aqui manualmente.
    // Também garante que não se edite conta cujo vencimento original já está em mês trancado.
    const competenciaAtual = this.competenciaDeDataCivil(atual.dataVencimento);
    if (await this.fechamentoService.isCompetenciaFechada(competenciaAtual)) {
      throw new AppException({
        status: 422,
        code: 'PERIOD_LOCKED',
        message: 'A data de vencimento atual desta conta pertence a um mês trancado para auditoria.',
        fields: { competencia: competenciaAtual },
      });
    }

    const novoVencimento = input.dataVencimento ? new Date(input.dataVencimento) : atual.dataVencimento;
    const competencia = this.competenciaDeDataCivil(novoVencimento);
    if (await this.fechamentoService.isCompetenciaFechada(competencia)) {
      throw new AppException({
        status: 422,
        code: 'PERIOD_LOCKED',
        message: 'Este mês está trancado para auditoria. Contate o administrador.',
        fields: { competencia },
      });
    }

    const atualizada = await this.prisma.contaPagar.update({
      where: { id },
      data: {
        fornecedor: input.fornecedor,
        categoria: input.categoria,
        valor: input.valor,
        dataVencimento: input.dataVencimento ? novoVencimento : undefined,
        observacao: input.observacao,
      },
      include: { criadoPor: { select: { nome: true } } },
    });
    return this.contaPagarParaResposta(atualizada);
  }

  /** Baixa da conta — quando `origemRecurso` é `caixa_local`, também cria a
   * MovimentacaoCaixa (`despesa_caixa`) correspondente, na mesma transação
   * (Card E2: baixa via caixa local precisa refletir no cofre atomicamente). */
  async pagarContaPagar(
    id: string,
    input: PagarContaPagarInput,
    usuarioId: string,
  ): Promise<ContaPagarResposta> {
    const atual = await this.buscarContaPagarOuFalhar(id);
    if (atual.status !== 'pendente') {
      throw new AppException({
        status: 409,
        code: 'CONFLICT',
        message: 'Esta conta já foi paga ou cancelada.',
      });
    }

    const competenciaVencimento = this.competenciaDeDataCivil(atual.dataVencimento);
    if (await this.fechamentoService.isCompetenciaFechada(competenciaVencimento)) {
      throw new AppException({
        status: 422,
        code: 'PERIOD_LOCKED',
        message: 'A data de vencimento desta conta pertence a um mês trancado para auditoria.',
        fields: { competencia: competenciaVencimento },
      });
    }

    const atualizada = await this.prisma.$transaction(async (tx) => {
      const contaPaga = await tx.contaPagar.update({
        where: { id },
        data: {
          status: 'pago',
          dataPagamento: new Date(input.dataPagamento),
          formaPagamento: input.formaPagamento,
          origemRecurso: input.origemRecurso,
        },
        include: { criadoPor: { select: { nome: true } } },
      });

      if (input.origemRecurso === 'caixa_local') {
        const responsavel = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { nome: true } });
        await tx.movimentacaoCaixa.create({
          data: {
            dataHora: new Date(),
            tipo: 'despesa_caixa',
            valor: atual.valor,
            descricao: `Pagamento: ${atual.fornecedor} (${atual.codigo})`,
            categoria: atual.categoria,
            responsavel: responsavel?.nome ?? 'Sistema',
            usuarioId,
            contaPagarId: atual.id,
          },
        });
      }

      return contaPaga;
    });

    return this.contaPagarParaResposta(atualizada);
  }

  // -------------------------------------------------------------------
  // Contas a receber — só leitura hoje (Card F1). Previsão é alimentada por
  // vendas do PDV / conciliação, não por cadastro manual — ver
  // packages/contracts/src/financeiro.ts.
  // -------------------------------------------------------------------

  async listarContasReceber(query: ListaContasReceberQuery): Promise<ContaReceberListaResposta> {
    const { page, pageSize, status } = query;
    const where = status ? { status } : {};
    const [registros, total] = await Promise.all([
      this.prisma.contaReceber.findMany({
        where,
        orderBy: { dataPrevisao: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contaReceber.count({ where }),
    ]);

    return {
      data: registros.map((registro) => this.contaReceberParaResposta(registro)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  // -------------------------------------------------------------------
  // Caixa físico / cofre (Card G1)
  // -------------------------------------------------------------------

  async listarMovimentacoesCaixa(query: ListaMovimentacoesCaixaQuery): Promise<MovimentacaoCaixaListaResposta> {
    const { page, pageSize } = query;
    const [registros, total] = await Promise.all([
      this.prisma.movimentacaoCaixa.findMany({
        orderBy: { dataHora: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.movimentacaoCaixa.count(),
    ]);

    return {
      data: registros.map((registro) => this.movimentacaoParaResposta(registro)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async criarMovimentacaoCaixa(
    input: CriarMovimentacaoCaixaInput,
    usuarioId: string,
  ): Promise<MovimentacaoCaixaResposta> {
    const criada = await this.prisma.movimentacaoCaixa.create({
      data: {
        dataHora: new Date(),
        tipo: input.tipo,
        valor: input.valor,
        descricao: input.descricao,
        categoria: input.categoria,
        responsavel: input.responsavel,
        usuarioId,
      },
    });
    return this.movimentacaoParaResposta(criada);
  }

  async saldoCaixa(): Promise<SaldoCaixaResposta> {
    const [entradas, saidas] = await Promise.all([
      this.prisma.movimentacaoCaixa.aggregate({ where: { tipo: 'suprimento' }, _sum: { valor: true } }),
      this.prisma.movimentacaoCaixa.aggregate({
        where: { tipo: { in: ['sangria', 'despesa_caixa'] } },
        _sum: { valor: true },
      }),
    ]);
    const totalEntradas = entradas._sum.valor?.toNumber() ?? 0;
    const totalSaidas = saidas._sum.valor?.toNumber() ?? 0;
    return { saldo: Number((totalEntradas - totalSaidas).toFixed(2)) };
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private async buscarContaPagarOuFalhar(id: string): Promise<ContaPagar> {
    const registro = await this.prisma.contaPagar.findUnique({ where: { id } });
    if (!registro) {
      throw new AppException({ status: 404, code: 'NOT_FOUND', message: 'Conta a pagar não encontrada.' });
    }
    return registro;
  }

  /** Código sequencial legível (`CP-00001`), com fallback por sufixo
   * aleatório em caso de corrida (baixíssima chance numa instância única de
   * dev, mas o `codigo` é @unique no banco — não deixamos a criação
   * quebrar por causa disso). */
  private async proximoCodigo(model: 'contaPagar', prefixo: string): Promise<string> {
    const total = await this.prisma[model].count();
    const candidato = `${prefixo}-${String(total + 1).padStart(5, '0')}`;
    const existente = await this.prisma[model].findUnique({ where: { codigo: candidato } });
    return existente ? `${prefixo}-${randomUUID().slice(0, 8).toUpperCase()}` : candidato;
  }

  private competenciaDeDataCivil(data: Date): string {
    return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private situacaoDe(conta: ContaPagar): SituacaoContaPagar {
    if (conta.status === 'pago') return 'pago';
    if (conta.status === 'cancelado') return 'cancelado';
    const hoje = dataCivilEmFusoLoja(new Date());
    const vencimento = conta.dataVencimento.toISOString().slice(0, 10);
    if (vencimento === hoje) return 'vence_hoje';
    if (vencimento < hoje) return 'vencido';
    return 'em_dia';
  }

  private contaPagarParaResposta(conta: ContaPagarComCriador): ContaPagarResposta {
    return {
      id: conta.id,
      codigo: conta.codigo,
      fornecedor: conta.fornecedor,
      categoria: conta.categoria,
      valor: toMoney(conta.valor) as number,
      dataVencimento: conta.dataVencimento.toISOString().slice(0, 10),
      dataPagamento: conta.dataPagamento ? conta.dataPagamento.toISOString().slice(0, 10) : null,
      formaPagamento: conta.formaPagamento,
      origemRecurso: conta.origemRecurso,
      status: conta.status,
      situacao: this.situacaoDe(conta),
      observacao: conta.observacao,
      criadoPorNome: conta.criadoPor.nome,
    };
  }

  private contaReceberParaResposta(conta: ContaReceber) {
    return {
      id: conta.id,
      codigo: conta.codigo,
      origemDescricao: conta.origemDescricao,
      meioPagamento: conta.meioPagamento,
      valorBruto: toMoney(conta.valorBruto) as number,
      valorTaxaEstimada: toMoney(conta.valorTaxaEstimada) as number,
      valorLiquidoPrevisto: toMoney(conta.valorLiquidoPrevisto) as number,
      dataPrevisao: conta.dataPrevisao.toISOString().slice(0, 10),
      dataRecebimento: conta.dataRecebimento ? conta.dataRecebimento.toISOString().slice(0, 10) : null,
      status: conta.status,
    };
  }

  private movimentacaoParaResposta(mov: MovimentacaoCaixa): MovimentacaoCaixaResposta {
    return {
      id: mov.id,
      dataHora: mov.dataHora.toISOString(),
      tipo: mov.tipo,
      valor: toMoney(mov.valor) as number,
      descricao: mov.descricao,
      categoria: mov.categoria,
      responsavel: mov.responsavel,
    };
  }
}
