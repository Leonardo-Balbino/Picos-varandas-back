import { Module } from '@nestjs/common';
import { ConfiguracoesController } from './configuracoes.controller';
import { ConfiguracoesService } from './configuracoes.service';

/** Categorias financeiras e taxas de gateway — Card J1. Não existia como
 * módulo até esta sessão (só usuários/dashboard/financeiro tinham
 * placeholder do esqueleto do Card A1) — registrado em app.module.ts. */
@Module({
  controllers: [ConfiguracoesController],
  providers: [ConfiguracoesService],
})
export class ConfiguracoesModule {}
