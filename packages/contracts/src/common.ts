import { z } from 'zod';

/**
 * Formas transversais usadas por praticamente todo endpoint — paginação
 * (seção 3.9), envelope de erro (seção 3.8) e o helper de schema de request
 * (seção 3.10). Extraído de index.ts (que virou barrel) quando os domínios
 * de negócio (D/E/F/G/H/I/J) começaram a entrar, cada um no seu próprio
 * arquivo — um único index.ts de milhares de linhas seria difícil de
 * revisar e um ímã de conflito de merge.
 */

// ---------------------------------------------------------------------------
// Paginação — seção 3.9
// ---------------------------------------------------------------------------

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  // Teto elevado de 200 para 2000 (Card D2): telas que buscam "tudo de uma conta" de uma vez
  // (conciliação, com extrato bancário real importado passando de mil linhas) precisam de mais
  // que 200 para não truncar silenciosamente — nenhuma tela hoje faz paginação de UI de verdade,
  // é sempre "busca tudo, filtra no cliente" (ver conciliacaoStore.ts do frontend).
  pageSize: z.coerce.number().int().positive().max(2000).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    meta: paginationMetaSchema,
  });
}

// ---------------------------------------------------------------------------
// Envelope de erro padrão — seção 3.8
// ---------------------------------------------------------------------------

export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'PERIOD_LOCKED',
  'CONFLICT',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'UNBALANCED',
  'INSUFFICIENT_FUNDS',
  // Não fazem parte da lista fechada da seção 3.8 do documento — adicionados
  // nesta sessão porque o filtro global precisa de um código para casos que
  // a seção 3.8 não previu.
  'RATE_LIMITED', // 429 do @nestjs/throttler (Card B1) — rotas de login.
  'INTERNAL_ERROR', // fallback para qualquer exceção não mapeada.
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
    traceId: z.string(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Convenção de schema de entrada — seção 3.10
// ---------------------------------------------------------------------------

/**
 * Todo schema de request passa por aqui em vez de `z.object(shape)` direto.
 * `.strict()` é o equivalente Zod de `whitelist: true` + `forbidNonWhitelisted:
 * true` do class-validator: chave desconhecida no payload vira erro de
 * validação em vez de ser silenciosamente descartada. Usar este helper (em
 * vez de lembrar de chamar `.strict()` em cada schema individualmente)
 * torna esse comportamento o padrão, não uma escolha por endpoint.
 */
export function requestSchema<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

// ---------------------------------------------------------------------------
// Competência (AAAA-MM) — usado pelo guard de período (Card H2) e por todo
// endpoint que precisa expressar "mês de referência" sem ambiguidade de
// fuso (seção 3.3: datas civis não carregam hora nem fuso).
// ---------------------------------------------------------------------------

export const competenciaSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Competência deve estar no formato AAAA-MM.');
export type Competencia = z.infer<typeof competenciaSchema>;

// ---------------------------------------------------------------------------
// Enums de domínio compartilhados entre mais de um arquivo de contrato
// (financeiro, conciliação, configurações, dashboard). Espelham 1:1 os
// enums do Prisma (Card A2) — minúsculo, de propósito: o schema.prisma é a
// fonte da verdade, nada de traduzir para maiúsculo só para bater com um
// mock antigo de frontend (mesmo princípio já aplicado a perfilUsuarioSchema
// em auth.ts — o front reconcilia do lado dele).
// ---------------------------------------------------------------------------

export const formaPagamentoSchema = z.enum([
  'dinheiro',
  'pix',
  'cartao_credito',
  'cartao_debito',
  'voucher',
]);
export type FormaPagamento = z.infer<typeof formaPagamentoSchema>;

export const tipoTransacaoSchema = z.enum(['credito', 'debito']);
export type TipoTransacao = z.infer<typeof tipoTransacaoSchema>;

export const statusConciliacaoSchema = z.enum(['pendente', 'conciliado', 'divergente', 'ignorado']);
export type StatusConciliacao = z.infer<typeof statusConciliacaoSchema>;
