import { z } from 'zod';
import { requestSchema } from './common';

/**
 * Storage de arquivos — Card A4. Upload é multipart/form-data (não JSON): o
 * arquivo em si vai no campo `arquivo`, os demais campos do formulário (só
 * `contexto` por enquanto) são validados por este schema contra
 * `request.body` normalmente — nestjs-zod não faz distinção entre corpo
 * JSON e campos de texto de um multipart, ambos chegam como objeto simples.
 */
export const contextoArquivoSchema = z.enum(['extrato', 'comprovante', 'backup']);
export type ContextoArquivo = z.infer<typeof contextoArquivoSchema>;

export const uploadArquivoBodySchema = requestSchema({
  contexto: contextoArquivoSchema,
});
export type UploadArquivoBodyInput = z.infer<typeof uploadArquivoBodySchema>;

export const arquivoRespostaSchema = z.object({
  arquivoId: z.string(),
  chaveArquivo: z.string(),
  nomeOriginal: z.string(),
  mimeType: z.string(),
  tamanhoBytes: z.number().int(),
  contexto: contextoArquivoSchema,
});
export type ArquivoResposta = z.infer<typeof arquivoRespostaSchema>;
