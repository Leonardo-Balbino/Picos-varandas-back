import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PerfilUsuario } from 'contracts';
import { AuthService } from '../../modules/auth/auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppException } from '../exceptions/app.exception';
import type { RequestWithUser } from '../types/request-with-user';

/**
 * Guard global de autenticação + RBAC (Card B2). Substitui o JwtAuthGuard
 * pontual do Card B1 (removido) — a verificação de Bearer/tokenVersion vive
 * só aqui agora, para toda a API de uma vez, em vez de cada controller
 * lembrar de aplicar um guard.
 *
 * Ordem de decisão:
 * 1. @Public() na rota → libera sem checar nada.
 * 2. Sem @Public() → exige Authorization: Bearer válido (AuthService.
 *    validarAccessToken, mesma lógica de antes: assinatura, expiração,
 *    tokenVersion/ativo ao vivo no banco).
 * 3. @Roles(...) na rota → perfil do usuário autenticado precisa estar na
 *    lista, senão 403 FORBIDDEN. Sem @Roles = qualquer perfil autenticado
 *    passa.
 *
 * Registrado como APP_GUARD em SecurityModule, depois do ThrottlerGuard —
 * ver o comentário em security.module.ts para o porquê da ordem.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const authHeader = request.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

    if (!token) {
      throw new AppException({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Requisição não autenticada.',
      });
    }

    const payload = await this.authService.validarAccessToken(token);
    request.user = { id: payload.sub, perfil: payload.perfil };

    const perfisExigidos = this.reflector.getAllAndOverride<PerfilUsuario[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (perfisExigidos && perfisExigidos.length > 0 && !perfisExigidos.includes(payload.perfil)) {
      throw new AppException({
        status: 403,
        code: 'FORBIDDEN',
        message: 'Perfil sem permissão para este recurso.',
      });
    }

    return true;
  }
}
