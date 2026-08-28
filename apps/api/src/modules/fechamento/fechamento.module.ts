import { Module } from '@nestjs/common';
import { FechamentoService } from './fechamento.service';

/**
 * Grade anual de fechamento (H1) e trancar/destrancar mês + guard global de
 * bloqueio de período (H2). Hoje só exporta FechamentoService (usado pelo
 * PeriodoGuard global via SecurityModule) — controller com os endpoints de
 * consulta/trancar/destrancar entra na Fase 4 (H1 + resto de H2).
 */
@Module({
  providers: [FechamentoService],
  exports: [FechamentoService],
})
export class FechamentoModule {}
