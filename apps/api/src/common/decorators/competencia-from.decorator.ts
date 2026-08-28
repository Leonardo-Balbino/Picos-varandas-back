import { SetMetadata } from '@nestjs/common';

/**
 * Aponta, explicitamente, de onde o PeriodoGuard (Card H2) deve extrair a
 * competência (AAAA-MM ou uma data civil AAAA-MM-DD, da qual só os 7
 * primeiros caracteres importam) de uma rota de escrita. Nunca por
 * adivinhação — dois formatos de caminho suportados:
 *
 *   @CompetenciaFrom('body.dataPagamento')   // campo do corpo da requisição
 *   @CompetenciaFrom('params.competencia')   // segmento da própria rota
 *
 * Limite conhecido (documentar ao usar): isto só alcança dados já
 * presentes na requisição (corpo/params), não o registro no banco. Rotas
 * cuja competência só existe no registro EXISTENTE (ex.: DELETE sobre uma
 * conta a pagar cujo vencimento não vem no payload do DELETE) não podem
 * usar este decorator — o próprio service deve chamar
 * `FechamentoService.isCompetenciaFechada(...)` manualmente depois de
 * carregar o registro, antes de mutar.
 */
export const COMPETENCIA_FROM_KEY = 'competenciaFrom';
export const CompetenciaFrom = (caminho: string): MethodDecorator =>
  SetMetadata(COMPETENCIA_FROM_KEY, caminho);
