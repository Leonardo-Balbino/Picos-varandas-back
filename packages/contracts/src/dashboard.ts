import { z } from 'zod';
import { competenciaSchema, formaPagamentoSchema } from './common';

/** GET /dashboard?anoMes=AAAA-MM (Cards C1/C2) — KPIs agregados + série
 * diária de fluxo de caixa + distribuição por meio de pagamento, todos
 * escopados ao mês pedido (sistema é monoloja, sem parâmetro de loja). */
export const dashboardQuerySchema = z.object({ anoMes: competenciaSchema });
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

const fluxoCaixaDiarioSchema = z.object({
  dia: z.string(),
  entradas: z.number(),
  saidas: z.number(),
});
export type FluxoCaixaDiario = z.infer<typeof fluxoCaixaDiarioSchema>;

const distribuicaoPagamentoSchema = z.object({
  formaPagamento: formaPagamentoSchema,
  percentual: z.number(),
  valor: z.number(),
});
export type DistribuicaoPagamento = z.infer<typeof distribuicaoPagamentoSchema>;

export const dashboardResumoSchema = z.object({
  faturamentoBruto: z.number(),
  contasAPagar: z.number(),
  contasAPagarVencendoEm7Dias: z.number(),
  contasAReceber: z.number(),
  caixaLocal: z.number(),
  entradasMes: z.number(),
  saidasMes: z.number(),
  taxasGatewayMes: z.number(),
  vendasPendentesConciliacao: z.number(),
  fluxoCaixaDiario: z.array(fluxoCaixaDiarioSchema),
  distribuicaoPagamentos: z.array(distribuicaoPagamentoSchema),
});
export type DashboardResumo = z.infer<typeof dashboardResumoSchema>;

// =============================================================================
// Dashboard Executivo Mobile — Restaurante Varandas
// =============================================================================

export const dashboardMobileQuerySchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type DashboardMobileQuery = z.infer<typeof dashboardMobileQuerySchema>;

export const garcomRankingSchema = z.object({
  posicao: z.number().int().positive(),
  idGarcom: z.number().int(),
  nomeGarcom: z.string(),
  totalItens: z.number().int().nonnegative(),
  totalFaturado: z.number().nonnegative(),
  comissaoEstimada: z.number().nonnegative(),
  percentualDoTotal: z.number().min(0).max(100),
});
export type GarcomRanking = z.infer<typeof garcomRankingSchema>;

export const produtoRankingSchema = z.object({
  posicao: z.number().int().positive(),
  idProduto: z.number().int(),
  nome: z.string(),
  categoria: z.string(),
  tipoCategoria: z.enum(['BEBIDA', 'COZINHA']),
  quantidade: z.number().nonnegative(),
  receitaTotal: z.number().nonnegative(),
  custoTotal: z.number().nonnegative(),
  margemLucroPercentual: z.number(),
});
export type ProdutoRanking = z.infer<typeof produtoRankingSchema>;

export const evolucaoDiariaMobileSchema = z.object({
  dia: z.number().int(),
  data: z.string(),
  faturamento: z.number().nonnegative(),
  pedidos: z.number().int().nonnegative(),
});
export type EvolucaoDiariaMobile = z.infer<typeof evolucaoDiariaMobileSchema>;

export const benchmarkingDiaSchema = z.object({
  mediaHistorica8Semanas: z.number().nonnegative(),
  diferencaPercentual: z.number(),
  desempenhoStatus: z.enum(['acima', 'abaixo', 'estavel']),
  metaDoDia: z.number().nonnegative(),
  percentualAtingidoMeta: z.number().min(0),
});
export type BenchmarkingDia = z.infer<typeof benchmarkingDiaSchema>;

export const dashboardMobileResumoSchema = z.object({
  dataReferencia: z.string(),
  diaDaSemanaTexto: z.string(),
  kpis: z.object({
    faturamentoBruto: z.number().nonnegative(),
    lucroBrutoEstimado: z.number(),
    margemBrutaPercentual: z.number(),
    ticketMedio: z.number().nonnegative(),
    totalPedidos: z.number().int().nonnegative(),
    benchmarking: benchmarkingDiaSchema,
  }),
  evolucaoMes: z.array(evolucaoDiariaMobileSchema),
  rankingGarcons: z.array(garcomRankingSchema),
  rankingProdutos: z.object({
    todos: z.array(produtoRankingSchema),
    bebidas: z.array(produtoRankingSchema),
    cozinha: z.array(produtoRankingSchema),
  }),
  atualizadoEm: z.string(),
});
export type DashboardMobileResumo = z.infer<typeof dashboardMobileResumoSchema>;
