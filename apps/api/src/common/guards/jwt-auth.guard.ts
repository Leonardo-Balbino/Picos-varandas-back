import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthService } from '../../modules/auth/auth.service';
import { AppException } from '../exceptions/app.exception';
import type { RequestWithUser } from '../types/request-with-user';

/**
 * Exige `Authorization: Bearer <token>` válido. Usado localmente em
 * /auth/me e /auth/logout nesta fase (Card B1). O Card B2 introduz um
 * RolesGuard global que cobre a autenticação de toda a API — quando isso
 * acontecer, este guard deixa de ser necessário rota a rota (a verificação
 * some daqui e passa a viver só no RolesGuard, para não duplicar).
 *
 * A validação de fato (assinatura, expiração, tokenVersion contra o banco)
 * vive em AuthService.validarAccessToken — este guard só extrai o header e
 * delega, para que a mesma lógica sirva o RolesGuard do B2 sem duplicação.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
    return true;
  }
}
