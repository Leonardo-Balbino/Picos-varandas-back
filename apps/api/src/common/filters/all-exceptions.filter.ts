import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { AppException } from '../exceptions/app.exception';
import type { RequestWithTraceId } from '../types/request-with-trace';

/** Formato mínimo que nos interessa de um ZodError — só o array de issues. */
interface ZodLikeError {
  issues: Array<{ path: PropertyKey[]; message: string }>;
}

function isZodLikeError(value: unknown): value is ZodLikeError {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { issues?: unknown }).issues)
  );
}

interface ResolvedError {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
}

/**
 * Filtro global que produz o envelope de erro padrão da seção 3.8:
 *
 * { "error": { "code", "message", "fields", "traceId" } }
 *
 * Cobre quatro casos:
 * 1. AppException — já carrega code/fields de negócio explícitos.
 * 2. ZodValidationException (nestjs-zod, seção 3.10) — o corpo/query/params
 *    não bateu com o schema. `fields` é populado a partir de
 *    ZodError.issues: chave = path.join('.'), valor = message.
 * 3. Outras HttpException (ex.: NotFoundException do Nest) — mapeadas para
 *    um código default por status.
 * 4. Qualquer outra coisa (erro não tratado) — vira 500 com code
 *    INTERNAL_ERROR, logado com o traceId para permitir localizar a
 *    ocorrência no Cloud Logging (critério de pronto do Card A5).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithTraceId>();
    const traceId = request.traceId ?? 'sem-trace-id';

    const resolved = this.resolve(exception);

    if (resolved.status >= 500) {
      this.logger.error(
        `[${traceId}] ${resolved.message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(resolved.status).json({
      error: {
        code: resolved.code,
        message: resolved.message,
        ...(resolved.fields ? { fields: resolved.fields } : {}),
        traceId,
      },
    });
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        fields: exception.fields,
      };
    }

    if (exception instanceof ZodValidationException) {
      return {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Um ou mais campos são inválidos.',
        fields: this.buildZodFields(exception.getZodError()),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const rawMessage =
        typeof body === 'string'
          ? body
          : ((body as Record<string, unknown>)?.message ?? exception.message);

      return {
        status,
        code: this.defaultCodeFor(status),
        message: Array.isArray(rawMessage) ? rawMessage.join('; ') : String(rawMessage),
      };
    }

    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Erro interno no servidor.',
    };
  }

  /**
   * Chave = caminho do campo (ex.: "endereco.cep"); campo na raiz vira
   * "(raiz)". Mantém apenas a primeira mensagem por campo — igual ao
   * comportamento anterior com class-validator (um motivo por campo).
   */
  private buildZodFields(zodError: unknown): Record<string, string> {
    const fields: Record<string, string> = {};
    if (!isZodLikeError(zodError)) {
      return fields;
    }
    for (const issue of zodError.issues) {
      const key = issue.path.length > 0 ? issue.path.join('.') : '(raiz)';
      if (!(key in fields)) {
        fields[key] = issue.message;
      }
    }
    return fields;
  }

  private defaultCodeFor(status: number): string {
    switch (status) {
      case 400:
        return 'VALIDATION_ERROR';
      case 401:
        return 'UNAUTHORIZED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'VALIDATION_ERROR';
      // ThrottlerException (@nestjs/throttler, Card B1) responde 429 sem
      // subclasse própria — cai neste ramo genérico de HttpException. A
      // seção 3.8 do documento não previa rate limit e seu enum fechado de
      // códigos não tem entrada para 429; RATE_LIMITED foi adicionado a
      // apiErrorCodeSchema (packages/contracts) para não reaproveitar
      // INTERNAL_ERROR (sugere bug do servidor) nem UNAUTHORIZED (sugere
      // problema de credencial) para "excesso de tentativas".
      case 429:
        return 'RATE_LIMITED';
      default:
        return 'INTERNAL_ERROR';
    }
  }
}
