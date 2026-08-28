import Papa from 'papaparse';
import { extrairHoraOriginal, parseDataCivilBr, parseValorMonetario } from './parse-utils';
import type { LinhaExtratoNormalizada, ResultadoParser } from './parse-utils';

/**
 * Perfil de CSV do adquirente PixPag (Card D1) — modelado a partir de um
 * export real ("Movimentações Financeiras"), não do exemplo genérico da
 * spec original. Colunas: `#,Data,Valor,Tipo,Status,Transação`.
 *
 * `Tipo` observado com 5 valores literais: "Transação via adquirente"
 * (crédito — venda de cartão liquidada), "Pagamento Pix" (débito — Pix
 * enviado pelo restaurante), "Tarifa de Pix" (débito), "Estorno de
 * Pagamento Pix" / "Estorno de Tarifa Pix" (créditos). O sinal do valor já
 * é a fonte de verdade para crédito/débito — `Tipo` só alimenta a
 * categoria sugerida.
 *
 * `Transação` (última coluna) só vem preenchida nas linhas de "Transação
 * via adquirente" (é o lote de liquidação) — nas linhas de Pix vem vazia.
 */
const CATEGORIA_POR_TIPO: Record<string, string> = {
  'transação via adquirente': 'adquirente',
  'pagamento pix': 'pix',
  'tarifa de pix': 'tarifa',
  'estorno de pagamento pix': 'pix',
  'estorno de tarifa pix': 'tarifa',
};

/** Detecta o perfil pelo cabeçalho — usado pelo dispatcher (extrato-parser.ts)
 * antes de tentar de fato parsear, para dar um erro claro quando nenhum
 * perfil de CSV conhecido bate, em vez de silenciosamente importar 0 linhas. */
export function detectarCsvPixPag(linhaCabecalho: string): boolean {
  const colunas = Papa.parse<string[]>(linhaCabecalho.trim()).data[0] ?? [];
  const normalizadas = colunas.map((c) => c.trim().toLowerCase());
  return (
    normalizadas.includes('tipo') &&
    normalizadas.includes('status') &&
    normalizadas.some((c) => c.startsWith('transa'))
  );
}

export function parseCsvPixPag(conteudoUtf8: string): ResultadoParser {
  const resultado = Papa.parse<Record<string, string>>(conteudoUtf8, {
    header: true,
    skipEmptyLines: true,
  });

  const avisos: string[] = [];
  if (resultado.errors.length > 0) {
    avisos.push(`${resultado.errors.length} linha(s) com erro de formatação CSV, ignorada(s).`);
  }

  const linhas: LinhaExtratoNormalizada[] = [];
  let semDocumento = 0;

  for (const linha of resultado.data) {
    const tipoBruto = (linha['Tipo'] ?? '').trim();
    const valorBruto = (linha['Valor'] ?? '').trim();
    if (!tipoBruto || !valorBruto) {
      continue; // linha vazia/malformada — já contabilizada em resultado.errors quando aplicável
    }

    const status = (linha['Status'] ?? '').trim();
    if (status.toLowerCase() !== 'confirmado') {
      avisos.push(`Lançamento #${linha['#'] ?? '?'} com status "${status}" — não importado (só "Confirmado" é considerado).`);
      continue;
    }

    const valorComSinal = parseValorMonetario(valorBruto, 'br');
    const documento = (linha['Transação'] ?? '').trim() || null;
    if (!documento) {
      semDocumento++;
    }

    linhas.push({
      dataTransacao: parseDataCivilBr(linha['Data'] ?? ''),
      descricaoOrigem: tipoBruto,
      documento,
      tipoTransacao: valorComSinal.isNegative() ? 'debito' : 'credito',
      valor: valorComSinal.abs(),
      categoriaSugerida: CATEGORIA_POR_TIPO[tipoBruto.toLowerCase()] ?? null,
      horaOriginal: extrairHoraOriginal(linha['Data'] ?? ''),
    });
  }

  if (semDocumento > 0) {
    avisos.push(
      `${semDocumento} lançamento(s) sem número de documento — hash de duplicidade calculado com descrição e valor (ver seção de hash em extratos.service.ts).`,
    );
  }

  return { linhas, avisos };
}
