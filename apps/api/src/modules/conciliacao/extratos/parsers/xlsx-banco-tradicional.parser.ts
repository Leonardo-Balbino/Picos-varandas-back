import * as XLSX from 'xlsx';
import { parseDataCivilBr, parseValorMonetario } from './parse-utils';
import type { LinhaExtratoNormalizada, ResultadoParser } from './parse-utils';

/**
 * Perfil de extrato bancário tradicional exportado como planilha .xlsx do
 * internet banking (Card D1) — quarto formato de arquivo, além do trio
 * csv/ofx/pdf da spec original. Achado real desta sessão: o extrato do
 * restaurante não vem em nenhum dos três formatos previstos, vem como
 * planilha com metadado de agência/conta antes da tabela de lançamentos:
 *
 *   linha 0: "AGENCIA","<num>","CONTA","<num>",""
 *   linha 1: (em branco)
 *   linha 2: "Data","Histórico","Documento","Valor (R$)","Saldo (R$)"
 *   linha 3+: lançamentos
 *
 * `Saldo (R$)` é o saldo corrente após o lançamento — não gravado (não faz
 * parte de `extratos_bancarios`), só ajuda a localizar a linha de
 * cabeçalho ao lado de `Histórico` (ver detectarXlsxBancoTradicional).
 *
 * Diferença crítica de formato numérico em relação ao CSV do PixPag: aqui
 * é padrão US ("R$ 1,246.00" — vírgula milhar, ponto decimal), não BR — ver
 * parse-utils.ts. Detectado por arquivo real, não suposição.
 */
function categoriaPorDescricao(descricao: string): string | null {
  const d = descricao.toLowerCase();
  if (d.startsWith('pix recebido') || d.startsWith('pix enviado')) return 'pix';
  if (d.startsWith('tarifa')) return 'tarifa';
  if (d.includes('antecipacao') || d.includes('antecipação')) return 'adquirente';
  return null;
}

/** Procura, nas primeiras linhas, a linha de cabeçalho real (o arquivo tem
 * metadado de agência/conta antes da tabela) — retorna o índice, ou `null`
 * se não achar nada parecido com este perfil. */
function localizarLinhaCabecalho(linhas: string[][]): number | null {
  for (let i = 0; i < Math.min(10, linhas.length); i++) {
    const normalizada = linhas[i].map((c) => String(c).trim().toLowerCase());
    if (normalizada.includes('histórico') && normalizada.some((c) => c.startsWith('saldo'))) {
      return i;
    }
  }
  return null;
}

export function detectarXlsxBancoTradicional(buffer: Buffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const linhas = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });
    return localizarLinhaCabecalho(linhas) !== null;
  } catch {
    return false;
  }
}

export function parseXlsxBancoTradicional(buffer: Buffer): ResultadoParser {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const todasLinhas = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' });

  const indiceCabecalho = localizarLinhaCabecalho(todasLinhas);
  if (indiceCabecalho === null) {
    throw new Error('Planilha não reconhecida como extrato bancário (cabeçalho "Histórico"/"Saldo" não encontrado).');
  }

  const cabecalho = todasLinhas[indiceCabecalho].map((c) => String(c).trim().toLowerCase());
  const idxData = cabecalho.indexOf('data');
  const idxHistorico = cabecalho.indexOf('histórico');
  const idxDocumento = cabecalho.indexOf('documento');
  const idxValor = cabecalho.findIndex((c) => c.startsWith('valor'));

  const linhas: LinhaExtratoNormalizada[] = [];
  const avisos: string[] = [];
  let semDocumento = 0;

  for (let i = indiceCabecalho + 1; i < todasLinhas.length; i++) {
    const linha = todasLinhas[i];
    const dataBruta = String(linha[idxData] ?? '').trim();
    const valorBruto = String(linha[idxValor] ?? '').trim();
    if (!dataBruta || !valorBruto) {
      continue; // linha em branco no fim da planilha, por exemplo
    }

    const valorComSinal = parseValorMonetario(valorBruto, 'us');
    const documento = String(linha[idxDocumento] ?? '').trim() || null;
    if (!documento) {
      semDocumento++;
    }
    const descricao = String(linha[idxHistorico] ?? '').trim();

    linhas.push({
      dataTransacao: parseDataCivilBr(dataBruta),
      descricaoOrigem: descricao,
      documento,
      tipoTransacao: valorComSinal.isNegative() ? 'debito' : 'credito',
      valor: valorComSinal.abs(),
      categoriaSugerida: categoriaPorDescricao(descricao),
      // Fonte não tem granularidade de hora (só "DD/MM/YYYY") — ver
      // comentário de horaOriginal em parse-utils.ts sobre o risco
      // remanescente de colisão de hash para lançamentos idênticos no
      // mesmo dia sem documento, nesta fonte especificamente.
      horaOriginal: null,
    });
  }

  if (semDocumento > 0) {
    avisos.push(
      `${semDocumento} lançamento(s) sem número de documento — hash de duplicidade calculado com descrição e valor (ver seção de hash em extratos.service.ts).`,
    );
  }

  return { linhas, avisos };
}
