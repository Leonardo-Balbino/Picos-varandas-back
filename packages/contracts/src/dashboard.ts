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
