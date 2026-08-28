import { SetMetadata } from '@nestjs/common';

/**
 * Marca uma rota como isenta de autenticação (Card B2). O RolesGuard global
 * checa este metadado primeiro — se presente, libera sem exigir
 * Authorization: Bearer. Usado em /auth/login, /auth/google, /auth/refresh
 * e nos dois endpoints de /health.
 *
 * Rotas do agente local (sync/heartbeat/backup, Cards I1/I2/I4) TAMBÉM
 * precisam de @Public(): sem ele, o RolesGuard global rejeitaria com 401
 * ANTES da requisição sequer chegar no HmacAuthGuard do controller (guards
 * globais rodam para toda rota, @Public() ou não, e todos precisam
 * aprovar). @Public() sozinho, porém, não basta — ele só faz o RolesGuard
 * se afastar, não autentica nada; por isso essas rotas SEMPRE combinam
 * @Public() com @UseGuards(HmacAuthGuard) explícito no controller, nunca
 * uma ou outra isoladamente.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
