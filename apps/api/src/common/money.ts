// Padrão monetário — regra crítica (seção 3.2). Toda coluna de dinheiro é
// Decimal @db.Decimal(14,2) no Prisma. Nunca Float — com ponto flutuante,
// 206.00 - 6.00 pode retornar 199.99999999999997 e o sistema rejeitaria uma
// conciliação legítima com HTTP 422 (card D3).
//
// Import do client gerado (Prisma 7, seção 3.4), não de @prisma/client: a
// partir da v7 o client não vive mais em node_modules.
import { Prisma } from '../generated/prisma/client';

/** Cálculos em Prisma.Decimal (decimal.js por baixo), nunca com number
 * intermediário. Comparações usam .equals(), nunca ===.
 *
 * Tipo do parâmetro escrito por extenso (não `Prisma.Decimal.Value`): no
 * client gerado da v7, `Decimal` é um alias de tipo para a instância, não
 * um namespace, então `.Value` não resolve mais nesse caminho de reexport
 * — o union abaixo é exatamente o que `Decimal.Value` continha antes. */
export const money = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

/** Uso exclusivo na serialização de resposta — conversão para number
 * apenas na borda da API, na camada de mapper. */
export const toMoney = (v: Prisma.Decimal | null): number | null =>
  v === null ? null : Number(v.toFixed(2));
