import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { RequestWithTraceId } from '../types/request-with-trace';

/**
 * Gera um UUID por requisição e o injeta no contexto, para permitir
 * correlacionar erro do usuário com a entrada no log (seção 3.5 do Card A1 e
 * 3.8 do documento — formato padrão de erro).
 */
@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: RequestWithTraceId, res: Response, next: NextFunction): void {
    const traceId = randomUUID();
    req.traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);
    next();
  }
}
