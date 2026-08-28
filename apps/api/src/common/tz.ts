// Padrão temporal (seção 3.3). Container roda com TZ=UTC (Dockerfile);
// persistência de instantes é sempre UTC. Toda agregação/derivação "por dia"
// ou "por mês civil" precisa converter explicitamente para o fuso da loja,
// senão uma venda às 22:30 BRT (01:30 UTC do dia seguinte) cai no dia/mês
// errado. `TZ_LOJA` é a constante única exigida pela seção 3.3 — nunca
// hardcodar 'America/Sao_Paulo' em outro lugar do código.
export const TZ_LOJA = 'America/Sao_Paulo';

/**
 * Deriva a competência ("AAAA-MM") de um instante, no fuso da loja — usado
 * pelo guard de período (Card H2) e pela ingestão do agente (Card I1) para
 * decidir se uma venda cai num mês trancado. `formatToParts` (não apenas
 * `.format()`) para não depender de qual separador/ordem a ICU do runtime
 * escolhe para uma locale — extrai year/month explicitamente pelo `type`.
 */
export function competenciaEmFusoLoja(instante: Date): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_LOJA,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instante);
  const ano = partes.find((p) => p.type === 'year')?.value;
  const mes = partes.find((p) => p.type === 'month')?.value;
  return `${ano}-${mes}`;
}

/** Data civil ("AAAA-MM-DD") de um instante, no fuso da loja — para
 * agregações "por dia" (dashboard, Cards C1/C2) fora de `$queryRaw`. Dentro
 * de `$queryRaw` continua preferível fazer a conversão no próprio SQL
 * (`AT TIME ZONE 'America/Sao_Paulo'`, seção 3.3) por performance quando
 * agregando muitas linhas; esta função é para o caso a caso em código TS. */
export function dataCivilEmFusoLoja(instante: Date): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_LOJA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instante);
  const ano = partes.find((p) => p.type === 'year')?.value;
  const mes = partes.find((p) => p.type === 'month')?.value;
  const dia = partes.find((p) => p.type === 'day')?.value;
  return `${ano}-${mes}-${dia}`;
}
