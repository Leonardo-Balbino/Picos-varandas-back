import { Module } from '@nestjs/common';
import { FechamentoModule } from '../fechamento/fechamento.module';
import { VendasSyncController } from './vendas/vendas-sync.controller';
import { VendasSyncService } from './vendas/vendas-sync.service';

/**
 * Ingestão de vendas do PDV via agente local (I1) e heartbeat /
 * monitoramento do agente (I2). I2 e os endpoints de backup do PDV legado
 * (I4) entram na Fase 5 do plano de execução de hoje — este módulo nasce
 * hoje só com I1, o mais urgente para desbloquear o desenvolvimento do
 * agente desktop.
 */
@Module({
  imports: [FechamentoModule],
  controllers: [VendasSyncController],
  providers: [VendasSyncService],
})
export class SyncModule {}
