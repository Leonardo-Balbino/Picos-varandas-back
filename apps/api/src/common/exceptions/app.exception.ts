import { HttpException } from '@nestjs/common';

export interface AppExceptionParams {
  /** Status HTTP a retornar (400, 403, 409, 422...). */
  status: number;
  /**
   * Código de negócio do envelope de erro (seção 3.8):
   * VALIDATION_ERROR | PERIOD_LOCKED | CONFLICT | NOT_FOUND |
   * UNAUTHORIZED | FORBIDDEN | UNBALANCED | INSUFFICIENT_FUNDS
   */
  code: string;
  message: string;
  fields?: Record<string, string>;
}

/**
 * Exceção base para regras de negócio que precisam de um `code` explícito no
 * envelope de erro padrão. Cards futuros (D3 — UNBALANCED, D4/E2/G1 —
 * INSUFFICIENT_FUNDS, H2 — PERIOD_LOCKED, B2 — CONFLICT/FORBIDDEN...) lançam
 * esta classe em vez de HttpException genérica, para que o
 * AllExceptionsFilter não precise adivinhar o código a partir do status.
 */
export class AppException extends HttpException {
  public readonly code: string;
  public readonly fields?: Record<string, string>;

  constructor({ status, code, message, fields }: AppExceptionParams) {
    super({ code, message, fields }, status);
    this.code = code;
    this.fields = fields;
  }
}
