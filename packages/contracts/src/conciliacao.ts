import { z } from 'zod';
import {
  formaPagamentoSchema,
  paginatedSchema,
  paginationQuerySchema,
  requestSchema,
  statusConciliacaoSchema,
  tipoTransacaoSchema,
} from './common';

/** Card D1 — importação de extrato bancário. `formato` é opcional: quando
 * ausente, o parser detecta pelo mimeType/extensão do arquivo já enviado
 * (Card A4) — mantido no contrato porque o cliente pode querer forçar um
 * formato específico quando a detecção automática for ambígua. */
export const processarExtratoSchema = requestSchema({
  arquivoId: z.string().min(1),
  banco: z.string().min(1),
  conta: z.string().min(1),
  formato: z.enum(['csv', 'ofx', 'pdf', 'xlsx']).optional(),
});
export type ProcessarExtratoInput = z.infer<typeof processarExtratoSchema>;

export const processarExtratoResponseSchema = z.object({
  arquivoId: z.string(),
  lidas: z.number().int(),
  importadas: z.number().int(),
  duplicadas: z.number().int(),
  rejeitadas: z.number().int(),
  periodo: z.object({
    inicio: z.string().nullable(),
    fim: z.string().nullable(),
  }),
  avisos: z.array(z.string()),
});
export type ProcessarExtratoResponse = z.infer<typeof processarExtratoResponseSchema>;

// ---------------------------------------------------------------------------
// Leitura / vínculo manual / match automático (Card D2/D3/D4)
// ---------------------------------------------------------------------------

// `banco`/`conta` filtram por igualdade exata (são os valores literais informados na importação —
// ver ImportarExtratoModal.vue do frontend); `busca` é aplicado como "contém" case-insensitive
// sobre a descrição do lançamento (extrato) ou o número do cupom (vendas PDV). `banco`/`conta` não
// fazem sentido para vendas PDV (não têm conta bancária) — o service ignora esses dois campos
// nesse caso, mas o schema é o mesmo para as duas rotas de leitura por simplicidade.
export const listaConciliacaoQuerySchema = paginationQuerySchema.extend({
  status: statusConciliacaoSchema.optional(),
  banco: z.string().min(1).optional(),
  conta: z.string().min(1).optional(),
  busca: z.string().min(1).optional(),
});
export type ListaConciliacaoQuery = z.infer<typeof listaConciliacaoQuerySchema>;

/** GET /conciliacao/extrato/contas — combinações banco/conta já usadas em algum lançamento
 * importado, para popular o seletor de conta na tela (Card D2). */
export const contaBancariaRespostaSchema = z.object({
  banco: z.string(),
  conta: z.string(),
  totalPendentes: z.number().int(),
});
export type ContaBancariaResposta = z.infer<typeof contaBancariaRespostaSchema>;

export const extratoItemRespostaSchema = z.object({
  id: z.string(),
  banco: z.string(),
  conta: z.string(),
  dataTransacao: z.string(),
  descricaoOrigem: z.string(),
  documento: z.string().nullable(),
  tipoTransacao: tipoTransacaoSchema,
  valor: z.number(),
  categoria: z.string().nullable(),
  statusConciliacao: statusConciliacaoSchema,
});
export type ExtratoItemResposta = z.infer<typeof extratoItemRespostaSchema>;

export const extratoListaRespostaSchema = paginatedSchema(extratoItemRespostaSchema);
export type ExtratoListaResposta = z.infer<typeof extratoListaRespostaSchema>;

export const vendaPdvItemRespostaSchema = z.object({
  id: z.string(),
  numeroCupom: z.string(),
  dataHora: z.string(),
  formaPagamento: formaPagamentoSchema,
  bandeira: z.string().nullable(),
  valorBruto: z.number(),
  valorDesconto: z.number(),
  valorLiquido: z.number(),
  statusConciliacao: statusConciliacaoSchema,
});
export type VendaPdvItemResposta = z.infer<typeof vendaPdvItemRespostaSchema>;

export const vendaPdvListaRespostaSchema = paginatedSchema(vendaPdvItemRespostaSchema);
export type VendaPdvListaResposta = z.infer<typeof vendaPdvListaRespostaSchema>;

/** POST /conciliacao/vincular — N:M de verdade (todo id de cada lado entra
 * na mesma Conciliacao), não só o primeiro id de cada array como o mock
 * antigo do frontend simplificava (ver PENDENCIAS_BACKEND.md do frontend,
 * seção 2). */
export const vincularConciliacaoSchema = requestSchema({
  extratoIds: z.array(z.string().min(1)).min(1, 'Selecione ao menos um lançamento de extrato.'),
  vendaPdvIds: z.array(z.string().min(1)).min(1, 'Selecione ao menos uma venda do PDV.'),
  observacao: z.string().optional(),
});
export type VincularConciliacaoInput = z.infer<typeof vincularConciliacaoSchema>;

export const vincularConciliacaoResponseSchema = z.object({
  conciliacaoId: z.string(),
  valorExtrato: z.number(),
  valorPdv: z.number(),
  diferencaAjuste: z.number(),
});
export type VincularConciliacaoResponse = z.infer<typeof vincularConciliacaoResponseSchema>;

export const matchAutoResponseSchema = z.object({ vinculados: z.number().int() });
export type MatchAutoResponse = z.infer<typeof matchAutoResponseSchema>;
