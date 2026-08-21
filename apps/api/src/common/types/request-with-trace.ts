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
}
