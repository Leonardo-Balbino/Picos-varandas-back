import type { PerfilUsuario } from '../../generated/prisma/enums';

/** Payload do access token JWT (Card B1). `tokenVersion` é comparado contra
 * usuarios.token_version a cada requisição autenticada — é o mecanismo que
 * faz `ativo: false` (que incrementa token_version) invalidar sessões
 * abertas imediatamente, sem esperar os 15 min de expiração do JWT. */
export interface AccessTokenPayload {
  sub: string;
  perfil: PerfilUsuario;
  tokenVersion: number;
}
