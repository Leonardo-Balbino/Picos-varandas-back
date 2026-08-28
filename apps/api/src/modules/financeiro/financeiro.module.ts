import { Module } from '@nestjs/common';
import { FechamentoModule } from '../fechamento/fechamento.module';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';

/** Contas a pagar (E1, E2), contas a receber (F1) e caixa físico/cofre (G1). */
@Module({
  imports: [FechamentoModule],
  controllers: [FinanceiroController],
  providers: [FinanceiroService],
  // Exportado para o DashboardModule reaproveitar `saldoCaixa()` em vez de
  // duplicar a query de saldo do cofre.
  exports: [FinanceiroService],
})
export class FinanceiroModule {}
