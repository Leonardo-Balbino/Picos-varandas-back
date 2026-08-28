import { Module } from '@nestjs/common';
import { ArquivosModule } from '../arquivos/arquivos.module';
import { FechamentoModule } from '../fechamento/fechamento.module';
import { ExtratosController } from './extratos/extratos.controller';
import { ExtratosService } from './extratos/extratos.service';

/**
 * Parser de extratos (D1) — implementado. Painel duplo (D2), conciliação
 * manual (D3) e motor de match automático (D4) ainda não — entram depois,
 * neste mesmo módulo.
 */
@Module({
  imports: [ArquivosModule, FechamentoModule],
  controllers: [ExtratosController],
  providers: [ExtratosService],
})
export class ConciliacaoModule {}
