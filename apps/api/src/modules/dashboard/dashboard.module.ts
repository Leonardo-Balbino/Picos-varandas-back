import { Module } from '@nestjs/common';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Endpoint agregador de KPIs (Card C1) e séries temporais / distribuição
 * por meio de pagamento (Card C2). */
@Module({
  imports: [FinanceiroModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
