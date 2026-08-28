import { Module } from '@nestjs/common';
import { FechamentoController } from './fechamento.controller';
import { FechamentoService } from './fechamento.service';

/**
 * Grade anual de fechamento (H1), trancar/destrancar mês (resto do H2) e o
 * guard global de bloqueio de período (H2, via FechamentoService, exportado
 * para o PeriodoGuard em SecurityModule).
 */
@Module({
  controllers: [FechamentoController],
  providers: [FechamentoService],
  exports: [FechamentoService],
})
export class FechamentoModule {}
