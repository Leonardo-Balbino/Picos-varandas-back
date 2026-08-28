import type { RequestWithUser } from './request-with-user';

/**
 * Convenção do AuditoriaInterceptor (Card B2): quando um service precisa
 * que o "antes" da mutação apareça na auditoria (update/delete — em
 * criação não existe "antes"), ele grava o snapshot aqui ANTES de mutar. O
 * interceptor só lê `auditoriaAntes` depois que o handler resolve com
 * sucesso; nunca escreve nele.
 *
 * Ex. num service: `request.auditoriaAntes = registroAntigo;` logo após
 * carregar o registro e antes do update/delete.
 */
export interface RequestWithAudit extends RequestWithUser {
  auditoriaAntes?: unknown;
}
