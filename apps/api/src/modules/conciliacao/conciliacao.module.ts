import { Module } from '@nestjs/common';
import { ArquivosModule } from '../arquivos/arquivos.module';
import { FechamentoModule } from '../fechamento/fechamento.module';
import { ConciliacaoController } from './conciliacao.controller';
import { ConciliacaoService } from './conciliacao.service';
import { ExtratosController } from './extratos/extratos.controller';
import { ExtratosService } from './extratos/extratos.service';

/**
 * Parser de extratos (D1), leitura (D2), vínculo manual (D3) e match
 * automático (D4) — todos implementados.
 */
@Module({
  imports: [ArquivosModule, FechamentoModule],
  controllers: [ExtratosController, ConciliacaoController],
  providers: [ExtratosService, ConciliacaoService],
})
export class ConciliacaoModule {}
