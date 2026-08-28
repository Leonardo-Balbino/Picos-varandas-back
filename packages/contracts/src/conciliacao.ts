import { z } from 'zod';
import { requestSchema } from './common';

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
