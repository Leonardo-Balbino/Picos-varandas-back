import { Module } from '@nestjs/common';

/**
 * Contas a pagar (E1, E2), contas a receber (F1) e caixa físico / cofre
 * (G1). O documento agrupa os três sob financeiro/ (seção 3.1: "financeiro/
 * # pagar, receber, caixa"). Placeholder do esqueleto modular do Card A1.
 */
@Module({})
export class FinanceiroModule {}
