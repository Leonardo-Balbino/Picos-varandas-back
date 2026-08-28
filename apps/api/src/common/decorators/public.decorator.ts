import { SetMetadata } from '@nestjs/common';

/**
 * Marca uma rota como isenta de autenticação (Card B2). O RolesGuard global
 * checa este metadado primeiro — se presente, libera sem exigir
 * Authorization: Bearer. Usado em /auth/login, /auth/google, /auth/refresh
 * e nos dois endpoints de /health.
 *
 * Rotas do agente local (sync/heartbeat/backup, Cards I1/I2/I4) NÃO usam
 * este decorator: elas são público do ponto de vista do RolesGuard (não têm
 * usuário/JWT), mas exigem HmacAuthGuard explícito no controller — @Public
 * sozinho as deixaria sem autenticação nenhuma.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
