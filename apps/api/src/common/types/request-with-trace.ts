import type { Request } from 'express';

/**
 * Request tipado com o traceId injetado pelo TraceIdMiddleware.
 *
 * Preferido a uma augmentação ambiente de 'express-serve-static-core'
 * (`declare module`) porque a augmentação global não estava sendo captada
 * de forma confiável pelo compilador do Nest CLI neste setup — uma
 * interface explícita é menos elegante, mas não depende de resolução de
 * módulo ambígua.
 */
export interface RequestWithTraceId extends Request {
  traceId: string;
  /** Identidade autenticada pelo HmacAuthGuard. Controllers nunca devem
   * confiar novamente no valor cru do header. */
  agentId?: string;
  // Populado pelo `verify` do body-parser em main.ts (bodyParser: false +
  // json({ verify })) — o HmacAuthGuard (Card I1) precisa do corpo BRUTO,
  // antes do parse JSON, para recalcular a assinatura HMAC do agente
  // exatamente como o agente a calculou. Ausente em rotas sem corpo (GET) e,
  // por construção do `verify`, sempre presente em rotas com corpo JSON —
  // opcional só porque o tipo não consegue expressar "presente quando
  // Content-Type é application/json".
  rawBody?: Buffer;
}
