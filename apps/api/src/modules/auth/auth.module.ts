import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Autenticação por e-mail/senha e Google OAuth 2.0 (Card B1), rotação de
 * refresh token.
 *
 * `JwtModule.registerAsync` (não `.register` direto) para ler JWT_SECRET
 * via ConfigService em vez de `process.env` no corpo do decorator —
 * `process.env` ali dependeria da ordem de import dos módulos ter carregado
 * o .env primeiro (InfraModule antes de AuthModule), o que funciona hoje
 * mas é frágil e implícito. `registerAsync` resolve isso em tempo de
 * injeção de dependência, depois que o ConfigModule certamente já rodou.
 *
 * RBAC e rate limit globais (Card B2, ThrottlerGuard + RolesGuard) saíram
 * daqui e viraram SecurityModule — este módulo só precisa exportar
 * AuthService (consumido pelo RolesGuard para validar o access token), não
 * mais registrar guard nenhum.
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
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
