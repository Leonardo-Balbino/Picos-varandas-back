import { createHmac } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { HmacAuthGuard } from './hmac-auth.guard';

const SEGREDO = 'segredo-de-teste-do-agente';

function assinar(timestamp: string, corpo: Buffer, segredo = SEGREDO): string {
  return createHmac('sha256', segredo).update(`${timestamp}.`).update(corpo).digest('hex');
}

function criarContexto(headers: Record<string, string>, rawBody: Buffer): ExecutionContext {
  const request = { headers, rawBody, traceId: 't1' };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('HmacAuthGuard (Card I1)', () => {
  const OLD_ENV = process.env.AGENT_HMAC_SECRET;

  beforeEach(() => {
    process.env.AGENT_HMAC_SECRET = SEGREDO;
  });

  afterAll(() => {
    process.env.AGENT_HMAC_SECRET = OLD_ENV;
  });

  it('aceita uma requisição com assinatura válida e timestamp recente', () => {
    const guard = new HmacAuthGuard();
    const corpo = Buffer.from(JSON.stringify({ vendas: [] }));
    const timestamp = new Date().toISOString();
    const assinatura = assinar(timestamp, corpo);

    const context = criarContexto(
      { 'x-agent-id': 'agente-varanda-01', 'x-timestamp': timestamp, 'x-signature': assinatura },
      corpo,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejeita quando falta algum header obrigatório', () => {
    const guard = new HmacAuthGuard();
    const corpo = Buffer.from('{}');
    const context = criarContexto({ 'x-agent-id': 'agente-1' }, corpo);

    expect(() => guard.canActivate(context)).toThrow();
  });

  it('rejeita assinatura calculada com segredo errado', () => {
    const guard = new HmacAuthGuard();
    const corpo = Buffer.from('{}');
    const timestamp = new Date().toISOString();
    const assinatura = assinar(timestamp, corpo, 'segredo-errado');

    const context = criarContexto(
      { 'x-agent-id': 'a1', 'x-timestamp': timestamp, 'x-signature': assinatura },
      corpo,
    );

    expect(() => guard.canActivate(context)).toThrow();
  });

  it('rejeita quando o corpo foi alterado em trânsito (assinatura não bate mais)', () => {
    const guard = new HmacAuthGuard();
    const corpoOriginal = Buffer.from(JSON.stringify({ vendas: [{ valor: 10 }] }));
    const timestamp = new Date().toISOString();
    const assinatura = assinar(timestamp, corpoOriginal);

    const corpoAlterado = Buffer.from(JSON.stringify({ vendas: [{ valor: 999999 }] }));
    const context = criarContexto(
      { 'x-agent-id': 'a1', 'x-timestamp': timestamp, 'x-signature': assinatura },
      corpoAlterado,
    );

    expect(() => guard.canActivate(context)).toThrow();
  });

  it('rejeita timestamp fora da janela de 5 minutos (replay)', () => {
    const guard = new HmacAuthGuard();
    const corpo = Buffer.from('{}');
    const timestampAntigo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const assinatura = assinar(timestampAntigo, corpo);

    const context = criarContexto(
      { 'x-agent-id': 'a1', 'x-timestamp': timestampAntigo, 'x-signature': assinatura },
      corpo,
    );

    expect(() => guard.canActivate(context)).toThrow();
  });

  it('rejeita X-Timestamp que não é uma data válida', () => {
    const guard = new HmacAuthGuard();
    const corpo = Buffer.from('{}');
    const context = criarContexto(
      { 'x-agent-id': 'a1', 'x-timestamp': 'nao-e-uma-data', 'x-signature': 'qualquer' },
      corpo,
    );

    expect(() => guard.canActivate(context)).toThrow();
  });

  it('lança erro de configuração (não 401) quando AGENT_HMAC_SECRET não está definido', () => {
    delete process.env.AGENT_HMAC_SECRET;
    const guard = new HmacAuthGuard();
    const corpo = Buffer.from('{}');
    const timestamp = new Date().toISOString();

    const context = criarContexto(
      { 'x-agent-id': 'a1', 'x-timestamp': timestamp, 'x-signature': 'qualquer' },
      corpo,
    );

    expect(() => guard.canActivate(context)).toThrow(/não está configurada/);
  });
});
