import { z } from 'zod';
import { requestSchema } from './common';

/**
 * Ingestão de vendas do PDV via agente local — Card I1. Autenticação por
 * HMAC-SHA256 (headers X-Agent-Id/X-Timestamp/X-Signature), não JWT — este
 * schema não tem relação com os schemas de auth.
 */

export const formaPagamentoSchema = z.enum([
  'dinheiro',
  'pix',
  'cartao_credito',
  'cartao_debito',
  'voucher',
]);
export type FormaPagamento = z.infer<typeof formaPagamentoSchema>;

/** Aceita string OU number para campos monetários — o PDV legado emite
 * number (ver exemplo de payload do Card I1: `"valorBruto": 154.00`), mas
 * o mapper interno (common/money.ts) usa Prisma.Decimal para o cálculo real
 * de qualquer forma, então o formato de entrada não compromete precisão:
 * o risco que money.ts existe para evitar é aritmética encadeada em
 * `number`, não o parse de um único literal decimal recebido uma vez. */
const valorMonetarioSchema = z.union([z.string(), z.number()]);

export const vendaPdvItemSchema = requestSchema({
  idExterno: z.string().min(1),
  numeroCupom: z.string().min(1),
  // ISO 8601 com Z (Card I3: "o agente converte na origem e envia sempre
  // ISO 8601 com Z").
  dataHora: z.iso.datetime(),
  valorBruto: valorMonetarioSchema,
  valorDesconto: valorMonetarioSchema.optional(),
  valorLiquido: valorMonetarioSchema,
  formaPagamento: formaPagamentoSchema,
  bandeira: z.string().optional(),
});
export type VendaPdvItemInput = z.infer<typeof vendaPdvItemSchema>;

export const ingerirVendasPdvSchema = requestSchema({
  loteId: z.string().min(1),
  parteAtual: z.number().int().positive(),
  totalPartes: z.number().int().positive(),
  // Fatiamento obrigatório em partes de 300 a 500 vendas (Card I1) — o
  // limite superior aqui (500) é reforçado na validação de entrada, não só
  // documentado; o inferior (300) é uma recomendação operacional ao
  // agente, não uma trava rígida do contrato (um lote final menor que 300
  // é normal e não deve ser rejeitado).
  vendas: z.array(vendaPdvItemSchema).min(1).max(500),
});
export type IngerirVendasPdvInput = z.infer<typeof ingerirVendasPdvSchema>;

export const vendaRejeitadaSchema = z.object({
  idExterno: z.string(),
  motivo: z.string(),
  competencia: z.string().optional(),
});
export type VendaRejeitada = z.infer<typeof vendaRejeitadaSchema>;

export const ingerirVendasPdvResponseSchema = z.object({
  loteId: z.string(),
  parteAtual: z.number().int(),
  recebidas: z.number().int(),
  criadas: z.number().int(),
  atualizadas: z.number().int(),
  ignoradas: z.number().int(),
  rejeitadas: z.array(vendaRejeitadaSchema),
});
export type IngerirVendasPdvResponse = z.infer<typeof ingerirVendasPdvResponseSchema>;
