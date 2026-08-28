import { createHmac, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import type { RequestWithTraceId } from '../types/request-with-trace';

const JANELA_ANTI_REPLAY_MS = 5 * 60 * 1000;

/**
 * Autenticação do agente local (Card I1) — HMAC-SHA256, não chave estática.
 * Aplicado explicitamente (`@UseGuards(HmacAuthGuard)`) nos controllers de
 * sync (vendas, heartbeat, backup), nunca globalmente: são as únicas rotas
 * sem usuário humano, então também não passam por @Public() do RolesGuard
 * — do ponto de vista do RolesGuard elas simplesmente não existem, porque
 * este guard roda no controller, não no pipeline global de segurança.
 *
 * `X-Signature = HMAC-SHA256(AGENT_HMAC_SECRET, X-Timestamp + "." + corpo_bruto)`.
 * O corpo BRUTO (request.rawBody, capturado em setup-app.ts antes do parse
 * JSON) é obrigatório aqui — reserializar o body já parseado não garante
 * os mesmos bytes que o agente assinou. A diferença em relação a uma API
 * key simples é material (seção do Card I1): a chave estática só prova
 * quem chamou; a assinatura prova que o corpo não foi alterado em trânsito
 * e que a requisição não é uma retransmissão de um lote capturado.
 */
@Injectable()
export class HmacAuthGuard implements CanActivate {
  private readonly logger = new Logger(HmacAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithTraceId>();

    const agentId = this.headerUnico(request.headers['x-agent-id']);
    const timestampBruto = this.headerUnico(request.headers['x-timestamp']);
    const assinatura = this.headerUnico(request.headers['x-signature']);

    if (!agentId || !timestampBruto || !assinatura) {
      throw this.naoAutorizado('Headers de autenticação do agente ausentes.');
    }

    const timestampMs = Date.parse(timestampBruto);
    if (Number.isNaN(timestampMs)) {
      throw this.naoAutorizado('X-Timestamp inválido.');
    }

    // Proteção contra replay (seção do Card I1): requer NTP ativo no
    // servidor do restaurante — documentado no card, não algo que este
    // guard pode verificar, só assumir.
    if (Math.abs(Date.now() - timestampMs) > JANELA_ANTI_REPLAY_MS) {
      throw this.naoAutorizado('X-Timestamp fora da janela de tolerância.');
    }

    const segredo = process.env.AGENT_HMAC_SECRET;
    if (!segredo) {
      // Falha de configuração do servidor, não do agente — não é 401.
      throw new AppException({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Autenticação do agente não está configurada.',
      });
    }

    const corpoBruto = request.rawBody ?? Buffer.alloc(0);
    const assinaturaEsperada = createHmac('sha256', segredo)
      .update(`${timestampBruto}.`)
      .update(corpoBruto)
      .digest('hex');

    if (!this.assinaturasIguais(assinatura, assinaturaEsperada)) {
      this.logger.warn(`[${request.traceId}] Assinatura HMAC inválida para agente '${agentId}'.`);
      throw this.naoAutorizado('Assinatura inválida.');
    }

    return true;
  }

  /** crypto.timingSafeEqual, nunca === (seção do Card I1) — e nunca deixar
   * o TypeError de tamanhos diferentes vazar como 500: assinatura de
   * tamanho errado é só mais um caso de "assinatura inválida" (401). */
  private assinaturasIguais(recebida: string, esperada: string): boolean {
    const bufA = Buffer.from(recebida, 'hex');
    const bufB = Buffer.from(esperada, 'hex');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  private headerUnico(valor: string | string[] | undefined): string | null {
    if (Array.isArray(valor)) {
      return valor[0] ?? null;
    }
    return valor ?? null;
  }

  private naoAutorizado(message: string): AppException {
    return new AppException({ status: 401, code: 'UNAUTHORIZED', message });
  }
}
