import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { SecurityModule } from './common/security/security.module';
import { TraceIdMiddleware } from './common/middleware/trace-id.middleware';
import { InfraModule } from './infra/infra.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConciliacaoModule } from './modules/conciliacao/conciliacao.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { FechamentoModule } from './modules/fechamento/fechamento.module';
import { FinanceiroModule } from './modules/financeiro/financeiro.module';
import { HealthModule } from './modules/health/health.module';
import { SyncModule } from './modules/sync/sync.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';

@Module({
  imports: [
    InfraModule,
    SecurityModule,
    HealthModule,
    AuthModule,
    UsuariosModule,
    DashboardModule,
    ConciliacaoModule,
    FinanceiroModule,
    FechamentoModule,
    SyncModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // '*path' (não '*') — path-to-regexp v6 (Express 5 / Nest 11) exige
    // parâmetro nomeado para wildcard; '*' sozinho gera warning de conversão.
    consumer.apply(TraceIdMiddleware).forRoutes('*path');
  }
}
