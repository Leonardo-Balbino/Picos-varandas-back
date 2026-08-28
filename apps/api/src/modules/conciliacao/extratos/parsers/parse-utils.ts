import { money } from '../../../../common/money';
import type { Prisma } from '../../../../generated/prisma/client';

/**
 * Dois formatos de número monetário REAIS confirmados a partir de arquivos
 * de extrato de verdade nesta sessão — não dá pra assumir um separador
 * fixo, o parser precisa saber qual estilo o perfil da fonte usa:
 *
 * - `'br'` (PixPag/adquirente): "R$ 1.038,31" — ponto milhar, vírgula
 *   decimal. Negativo com prefixo "- R$ " (espaço entre o sinal e o "R$").
 * - `'us'` (extrato bancário tradicional, xlsx): "R$ 1,246.00" — vírgula
 *   milhar, ponto decimal. Negativo com prefixo "-R$ " (sem espaço).
 */
export type EstiloNumerico = 'br' | 'us';

export function parseValorMonetario(bruto: string, estilo: EstiloNumerico): Prisma.Decimal {
  const negativo = /^\s*-/.test(bruto);
  let numerico = bruto
    .replace(/^\s*-\s*/, '')
    .replace(/R\$\s*/i, '')
    .trim();

  numerico = estilo === 'br' ? numerico.replace(/\./g, '').replace(',', '.') : numerico.replace(/,/g, '');

  const valor = money(numerico || '0');
  return negativo ? valor.negated() : valor;
}

/**
 * "DD/MM/YYYY" ou "DD/MM/YYYY HH:mm" → data civil (seção 3.3: extrato
 * bancário guarda data civil, não instante — a hora, quando presente na
 * fonte, é informativa e descartada aqui; `ExtratoBancario.dataTransacao`
 * é `@db.Date`). Meia-noite UTC representa o dia, não um horário real.
 */
export function parseDataCivilBr(bruto: string): Date {
  const [dataParte] = bruto.trim().split(/\s+/);
  const [dia, mes, ano] = dataParte.split('/').map(Number);
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** Extrai só a parte "HH:mm" de "DD/MM/YYYY HH:mm", se presente — usada
 * exclusivamente para desambiguar hash (ver LinhaExtratoNormalizada.
 * horaOriginal), nunca para persistir instante. */
export function extrairHoraOriginal(bruto: string): string | null {
  const partes = bruto.trim().split(/\s+/);
  return partes.length > 1 ? partes[1] : null;
}

/** Linha de extrato já normalizada, independente do formato de origem —
 * todo parser (csv, xlsx, e futuramente ofx/pdf) produz esta mesma forma. */
export interface LinhaExtratoNormalizada {
  dataTransacao: Date;
  descricaoOrigem: string;
  documento: string | null;
  tipoTransacao: 'credito' | 'debito';
  /** Sempre positivo — o sinal já foi resolvido em `tipoTransacao`. */
  valor: Prisma.Decimal;
  categoriaSugerida: string | null;
  /**
   * Hora original da fonte ("HH:mm"), só para desambiguar o HASH de
   * duplicidade — nunca persistida em `dataTransacao` (que é data civil,
   * seção 3.3). Achado real rodando esta sessão contra o arquivo de
   * exemplo do PixPag: o mesmo dia teve 8 lançamentos "Tarifa de Pix" de
   * -R$ 2,99 idênticos (mesma descrição, mesmo valor, sem documento) —
   * sem a hora no hash, 7 dessas 8 linhas REAIS colidiam e eram
   * descartadas como duplicata falsa (perda de dado silenciosa). `null`
   * quando a fonte não tem granularidade de hora (extrato bancário
   * tradicional, xlsx) — nesse caso o risco de colisão remanescente é uma
   * limitação real da fonte, não deste parser.
   */
  horaOriginal: string | null;
}

export interface ResultadoParser {
  linhas: LinhaExtratoNormalizada[];
  avisos: string[];
}
