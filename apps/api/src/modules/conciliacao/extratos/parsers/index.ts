import { AppException } from '../../../../common/exceptions/app.exception';
import type { ResultadoParser } from './parse-utils';

export type { LinhaExtratoNormalizada, ResultadoParser } from './parse-utils';

/**
 * Dispatcher de formato (Card D1). Parsers carregados sob demanda (seção
 * 3.6) — `import()` dinâmico, não `import` estático no topo do módulo: xlsx
 * é uma dependência de peso considerável (parser de OOXML), e a maioria das
 * requisições da API (dashboard, auth, etc.) nunca toca conciliação —
 * importá-la estaticamente adicionaria essa dependência ao cold start de
 * toda instância.
 *
 * Formatos suportados hoje: csv (perfil PixPag) e xlsx (perfil de extrato
 * bancário tradicional agência/conta) — os dois únicos com amostra real
 * disponível nesta sessão. ofx e pdf continuam no enum do contrato (Card
 * D1 prevê os quatro), mas sem parser implementado ainda — chegam quando
 * houver uma amostra real para modelar contra, mesmo raciocínio usado para
 * não inventar os dois formatos atuais a partir só da spec.
 */
export async function parseArquivoExtrato(
  buffer: Buffer,
  mimeType: string,
  nomeOriginal: string,
): Promise<ResultadoParser> {
  const extensao = nomeOriginal.split('.').pop()?.toLowerCase();

  const ehCsv = mimeType.includes('csv') || extensao === 'csv';
  const ehXlsx = mimeType.includes('spreadsheetml') || extensao === 'xlsx';

  if (ehCsv) {
    const { detectarCsvPixPag, parseCsvPixPag } = await import('./csv-pixpag.parser');
    const conteudoUtf8 = buffer.toString('utf-8');
    const primeiraLinha = conteudoUtf8.split(/\r?\n/, 1)[0] ?? '';
    if (!detectarCsvPixPag(primeiraLinha)) {
      throw new AppException({
        status: 422,
        code: 'VALIDATION_ERROR',
        message: 'Formato de CSV não reconhecido — nenhum perfil de extrato conhecido bate com o cabeçalho deste arquivo.',
      });
    }
    return parseCsvPixPag(conteudoUtf8);
  }

  if (ehXlsx) {
    const { detectarXlsxBancoTradicional, parseXlsxBancoTradicional } = await import(
      './xlsx-banco-tradicional.parser'
    );
    if (!detectarXlsxBancoTradicional(buffer)) {
      throw new AppException({
        status: 422,
        code: 'VALIDATION_ERROR',
        message: 'Planilha não reconhecida como extrato bancário — nenhum perfil conhecido bate com esta estrutura.',
      });
    }
    return parseXlsxBancoTradicional(buffer);
  }

  throw new AppException({
    status: 422,
    code: 'VALIDATION_ERROR',
    message: `Formato de arquivo não suportado para importação de extrato: ${mimeType} (${nomeOriginal}). Formatos aceitos hoje: csv, xlsx.`,
  });
}
