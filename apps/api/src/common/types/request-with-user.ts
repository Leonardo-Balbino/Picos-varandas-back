import type { RequestWithTraceId } from './request-with-trace';

/** Payload mínimo extraído e validado do access token pelo RolesGuard —
 * já confirmado contra o banco (usuário ativo, tokenVersion em dia). Nunca
 * contém dados sensíveis; é o suficiente para autorização e para a trilha
 * de auditoria (Card B2). */
export interface AuthenticatedUser {
  id: string;
  perfil: 'admin' | 'operador';
}

export interface RequestWithUser extends RequestWithTraceId {
  user: AuthenticatedUser;
}
