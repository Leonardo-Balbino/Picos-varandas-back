import { z } from 'zod';
import { formaPagamentoSchema, paginatedSchema, paginationQuerySchema, requestSchema } from './common';

/**
 * Contas a pagar (Card E1/E2), contas a receber (F1) e caixa físico/cofre
 * (G1) — os três agrupados sob financeiro/ no documento (seção 3.1).
 */

export const statusContaPagarSchema = z.enum(['pendente', 'pago', 'cancelado']);
export type StatusContaPagar = z.infer<typeof statusContaPagarSchema>;

export const statusReceberSchema = z.enum(['pendente', 'recebido', 'divergente']);
export type StatusReceber = z.infer<typeof statusReceberSchema>;

export const tipoMovCaixaSchema = z.enum(['suprimento', 'sangria', 'despesa_caixa']);
export type TipoMovCaixa = z.infer<typeof tipoMovCaixaSchema>;

export const origemRecursoSchema = z.enum(['conta_bancaria', 'caixa_local']);
export type OrigemRecurso = z.infer<typeof origemRecursoSchema>;

/** Derivada na leitura, nunca persistida (comentário do model ContaPagar em
 * schema.prisma) — calculada pelo service a partir de status/dataVencimento
 * comparados à data corrente. */
export const situacaoContaPagarSchema = z.enum(['em_dia', 'vence_hoje', 'vencido', 'pago', 'cancelado']);
export type SituacaoContaPagar = z.infer<typeof situacaoContaPagarSchema>;

// ---------------------------------------------------------------------------
// Contas a pagar
// ---------------------------------------------------------------------------

export const contaPagarRespostaSchema = z.object({
  id: z.string(),
  codigo: z.string(),
  fornecedor: z.string(),
  categoria: z.string(),
  valor: z.number(),
  dataVencimento: z.string(),
  dataPagamento: z.string().nullable(),
  formaPagamento: formaPagamentoSchema.nullable(),
  origemRecurso: origemRecursoSchema.nullable(),
  status: statusContaPagarSchema,
  situacao: situacaoContaPagarSchema,
  observacao: z.string().nullable(),
  criadoPorNome: z.string(),
});
export type ContaPagarResposta = z.infer<typeof contaPagarRespostaSchema>;

export const contaPagarListaRespostaSchema = paginatedSchema(contaPagarRespostaSchema);
export type ContaPagarListaResposta = z.infer<typeof contaPagarListaRespostaSchema>;

export const listaContasPagarQuerySchema = paginationQuerySchema.extend({
  status: statusContaPagarSchema.optional(),
});
export type ListaContasPagarQuery = z.infer<typeof listaContasPagarQuerySchema>;

export const criarContaPagarSchema = requestSchema({
  fornecedor: z.string().min(1, 'Fornecedor é obrigatório.'),
  categoria: z.string().min(1, 'Categoria é obrigatória.'),
  valor: z.number().positive('Valor deve ser maior que zero.'),
  dataVencimento: z.string().min(10, 'Data de vencimento é obrigatória (AAAA-MM-DD).'),
  observacao: z.string().optional(),
});
export type CriarContaPagarInput = z.infer<typeof criarContaPagarSchema>;

export const atualizarContaPagarSchema = requestSchema({
  fornecedor: z.string().min(1).optional(),
  categoria: z.string().min(1).optional(),
  valor: z.number().positive().optional(),
  dataVencimento: z.string().min(10).optional(),
  observacao: z.string().optional(),
});
export type AtualizarContaPagarInput = z.infer<typeof atualizarContaPagarSchema>;

/** POST .../:id/pagar — baixa da conta. Quando `origemRecurso` é
 * `caixa_local`, o service cria também uma `MovimentacaoCaixa` do tipo
 * `despesa_caixa` referenciando esta conta, na mesma transação. */
export const pagarContaPagarSchema = requestSchema({
  dataPagamento: z.string().min(10, 'Data de pagamento é obrigatória (AAAA-MM-DD).'),
  formaPagamento: formaPagamentoSchema,
  origemRecurso: origemRecursoSchema,
});
export type PagarContaPagarInput = z.infer<typeof pagarContaPagarSchema>;

// ---------------------------------------------------------------------------
// Contas a receber
// ---------------------------------------------------------------------------

export const contaReceberRespostaSchema = z.object({
  id: z.string(),
  codigo: z.string(),
  origemDescricao: z.string(),
  meioPagamento: formaPagamentoSchema,
  valorBruto: z.number(),
  valorTaxaEstimada: z.number(),
  valorLiquidoPrevisto: z.number(),
  dataPrevisao: z.string(),
  dataRecebimento: z.string().nullable(),
  status: statusReceberSchema,
});
export type ContaReceberResposta = z.infer<typeof contaReceberRespostaSchema>;

export const contaReceberListaRespostaSchema = paginatedSchema(contaReceberRespostaSchema);
export type ContaReceberListaResposta = z.infer<typeof contaReceberListaRespostaSchema>;

export const listaContasReceberQuerySchema = paginationQuerySchema.extend({
  status: statusReceberSchema.optional(),
});
export type ListaContasReceberQuery = z.infer<typeof listaContasReceberQuerySchema>;

// ---------------------------------------------------------------------------
// Caixa físico / cofre
// ---------------------------------------------------------------------------

export const movimentacaoCaixaRespostaSchema = z.object({
  id: z.string(),
  dataHora: z.string(),
  tipo: tipoMovCaixaSchema,
  valor: z.number(),
  descricao: z.string(),
  categoria: z.string().nullable(),
  responsavel: z.string(),
});
export type MovimentacaoCaixaResposta = z.infer<typeof movimentacaoCaixaRespostaSchema>;

export const movimentacaoCaixaListaRespostaSchema = paginatedSchema(movimentacaoCaixaRespostaSchema);
export type MovimentacaoCaixaListaResposta = z.infer<typeof movimentacaoCaixaListaRespostaSchema>;

export const listaMovimentacoesCaixaQuerySchema = paginationQuerySchema;
export type ListaMovimentacoesCaixaQuery = z.infer<typeof listaMovimentacoesCaixaQuerySchema>;

export const criarMovimentacaoCaixaSchema = requestSchema({
  tipo: tipoMovCaixaSchema,
  valor: z.number().positive('Valor deve ser maior que zero.'),
  descricao: z.string().min(1, 'Descrição é obrigatória.'),
  categoria: z.string().optional(),
  responsavel: z.string().min(1, 'Responsável é obrigatório.'),
});
export type CriarMovimentacaoCaixaInput = z.infer<typeof criarMovimentacaoCaixaSchema>;

export const saldoCaixaRespostaSchema = z.object({ saldo: z.number() });
export type SaldoCaixaResposta = z.infer<typeof saldoCaixaRespostaSchema>;
