import { z } from 'zod';
import { formaPagamentoSchema, requestSchema } from './common';

/** Categorias financeiras (Card J1) — allowlist de sugestão para os campos
 * livres `contas_pagar.categoria` / `movimentacoes_caixa.categoria`, não FK
 * obrigatória (ver comentário do model Categoria em schema.prisma). */
export const categoriaRespostaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  ativa: z.boolean(),
});
export type CategoriaResposta = z.infer<typeof categoriaRespostaSchema>;

export const criarCategoriaSchema = requestSchema({ nome: z.string().min(1, 'Nome é obrigatório.') });
export type CriarCategoriaInput = z.infer<typeof criarCategoriaSchema>;

export const atualizarCategoriaSchema = requestSchema({
  nome: z.string().min(1).optional(),
  ativa: z.boolean().optional(),
});
export type AtualizarCategoriaInput = z.infer<typeof atualizarCategoriaSchema>;

/** Taxas de gateway por meio/bandeira, com vigência (Card J1) — nunca
 * sobrescrita: uma nova vigência é sempre uma linha nova (ver model
 * TaxaGateway em schema.prisma); o service fecha a `vigenciaFim` da linha
 * anterior ao criar uma nova para o mesmo meio/bandeira. */
export const taxaGatewayRespostaSchema = z.object({
  id: z.string(),
  meioPagamento: formaPagamentoSchema,
  bandeira: z.string().nullable(),
  percentual: z.number(),
  diasLiquidacao: z.number().int(),
  antecipacaoAutomatica: z.boolean(),
  vigenciaInicio: z.string(),
  vigenciaFim: z.string().nullable(),
});
export type TaxaGatewayResposta = z.infer<typeof taxaGatewayRespostaSchema>;

export const criarTaxaGatewaySchema = requestSchema({
  meioPagamento: formaPagamentoSchema,
  bandeira: z.string().optional(),
  percentual: z.number().nonnegative(),
  diasLiquidacao: z.number().int().nonnegative(),
  antecipacaoAutomatica: z.boolean().optional(),
  vigenciaInicio: z.string().min(10, 'Data de vigência é obrigatória (AAAA-MM-DD).'),
});
export type CriarTaxaGatewayInput = z.infer<typeof criarTaxaGatewaySchema>;
