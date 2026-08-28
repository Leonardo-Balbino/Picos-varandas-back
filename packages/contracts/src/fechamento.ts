import { z } from 'zod';
import { requestSchema } from './common';

/** Grade anual de fechamento mensal (Card H1) e trancar/destrancar (H2).
 * Mês trancado materializa `faturamentoTotal`/`despesasTotal`/`saldoFinal`
 * no momento da trava (comentário do model FechamentoMensal em
 * schema.prisma) — leitura de mês trancado nunca recalcula. */
export const fechamentoRespostaSchema = z.object({
  id: z.string(),
  anoMes: z.string(),
  trancado: z.boolean(),
  trancadoEm: z.string().nullable(),
  trancadoPorNome: z.string().nullable(),
  faturamentoTotal: z.number(),
  despesasTotal: z.number(),
  saldoFinal: z.number(),
});
export type FechamentoResposta = z.infer<typeof fechamentoRespostaSchema>;

export const listaFechamentosResponseSchema = z.object({ data: z.array(fechamentoRespostaSchema) });
export type ListaFechamentosResponse = z.infer<typeof listaFechamentosResponseSchema>;

/** POST .../:anoMes/trancar — sem corpo (schema vazio e `.strict()`, para
 * rejeitar qualquer chave enviada por engano em vez de ignorá-la). */
export const trancarMesSchema = requestSchema({});
export type TrancarMesInput = z.infer<typeof trancarMesSchema>;

/** POST .../:anoMes/destrancar — exige justificativa (seção do Card H2: todo
 * destrave é evento excepcional e auditável). */
export const destrancarMesSchema = requestSchema({
  justificativaDestrave: z.string().min(10, 'Justificativa deve ter no mínimo 10 caracteres.'),
});
export type DestrancarMesInput = z.infer<typeof destrancarMesSchema>;
