import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditoriaModule } from '../../modules/auditoria/auditoria.module';
import { AuthModule } from '../../modules/auth/auth.module';
import { FechamentoModule } from '../../modules/fechamento/fechamento.module';
import { AuditoriaInterceptor } from '../interceptors/auditoria.interceptor';
import { PeriodoGuard } from '../guards/periodo.guard';
import { RolesGuard } from '../guards/roles.guard';

/**
 * Ponto único de registro dos guards/interceptors globais da API (Card B2).
 * Antes, `{ provide: APP_GUARD, useClass: ThrottlerGuard }` vivia dentro de
 * AuthModule — funcionava, mas deixava implícito que autenticação e rate
 * limit global são coisas de módulos diferentes. Concentrar aqui também
 * fixa a ORDEM de execução dos guards: Nest aplica providers APP_GUARD na
 * ordem em que aparecem no array `providers`, então ThrottlerGuard roda
 * antes de RolesGuard, que roda antes de PeriodoGuard — nessa ordem de
 * propósito: rate limit primeiro (rejeita sem gastar query de token),
 * depois autenticação/RBAC (rejeita sem checar competência de uma
 * requisição que nem deveria estar autenticada), só então o guard de
 * período (Card H2), que já pode assumir `request.user` populado.
 *
 * @Global(): os tokens APP_GUARD/APP_INTERCEPTOR já são globais por
 * natureza no Nest (afetam toda rota da aplicação, não só deste módulo);
 * marcar o módulo como @Global evita precisar reimportar SecurityModule em
 * cada módulo de domínio só para satisfazer o grafo de DI.
 */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    AuthModule,
    AuditoriaModule,
    FechamentoModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PeriodoGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditoriaInterceptor },
  ],
})
export class SecurityModule {}
