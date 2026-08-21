import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Autenticação por e-mail/senha e Google OAuth 2.0 (Card B1), rotação de
 * refresh token e rate limit nas rotas de credencial.
 *
 * `JwtModule.registerAsync` (não `.register` direto) para ler
 * JWT_SECRET via ConfigService em vez de `process.env` no corpo do
 * decorator — `process.env` ali dependeria da ordem de import dos módulos
 * ter carregado o .env primeiro (InfraModule antes de AuthModule), o que
 * funciona hoje mas é frágil e implícito. `registerAsync` resolve isso em
 * tempo de injeção de dependência, depois que o ConfigModule certamente já
 * rodou.
 *
 * ThrottlerGuard como APP_GUARD é global por construção do Nest (o token
 * APP_GUARD se aplica à aplicação inteira, não só a este módulo) — é assim
 * que "5 por minuto nas rotas de login" (via @Throttle no controller) e um
 * teto default para as demais rotas coexistem sem cada módulo precisar
 * declarar o próprio guard.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      global: false,
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
