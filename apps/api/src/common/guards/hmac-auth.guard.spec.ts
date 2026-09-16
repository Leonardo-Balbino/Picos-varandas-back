import { createHmac } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { HmacAuthGuard, limparCacheAssinaturas } from './hmac-auth.guard';

const SEGREDO = 'segredo-de-teste-do-agente-com-mais-de-32-bytes';

function assinar(timestamp: string, corpo: Buffer, segredo = SEGREDO, agentId = 'a1'): string {
  return createHmac('sha256', segredo).update(`${agentId}.${timestamp}.`).update(corpo).digest('hex');
}

function criarContexto(headers: Record<string, string>, rawBody: Buffer): ExecutionContext {
  const request = { headers, rawBody, traceId: 't1' };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('HmacAuthGuard (Card I1)', () => {
  const OLD_ENV = process.env.AGENT_HMAC_SECRET;
  const OLD_MAP = process.env.AGENT_HMAC_SECRETS_JSON;

  beforeEach(() => {
    limparCacheAssinaturas();
    process.env.AGENT_HMAC_SECRET = SEGREDO;
    delete process.env.AGENT_HMAC_SECRETS_JSON;
  });

  afterAll(() => {
    process.env.AGENT_HMAC_SECRET = OLD_ENV;
    process.env.AGENT_HMAC_SECRETS_JSON = OLD_MAP;
  });

  it('aceita uma requisição com assinatura válida e timestamp recente', () => {
    const guard = new HmacAuthGuard();
    const corpo = Buffer.from(JSON.stringify({ vendas: [] }));
    const timestamp = new Date().toISOString();
    const assinatura = assinar(timestamp, corpo, SEGREDO, 'agente-varanda-01');

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

  it('rejeita quando X-Agent-Id é alterado depois da assinatura', () => {
    const guard = new HmacAuthGuard();
    const corpo = Buffer.from('{}');
    const timestamp = new Date().toISOString();
    const assinatura = assinar(timestamp, corpo, SEGREDO, 'agente-original');
    const context = criarContexto(
      { 'x-agent-id': 'agente-forjado', 'x-timestamp': timestamp, 'x-signature': assinatura },
      corpo,
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
      { 'x-agent-id': 'a1', 'x-timestamp': timestamp, 'x-signature': '0'.repeat(64) },
      corpo,
    );

    expect(() => guard.canActivate(context)).toThrow(/não está configurada/);
  });

  it('seleciona um segredo diferente para cada agente cadastrado', () => {
    const segredoA = 'a'.repeat(32);
    const segredoB = 'b'.repeat(32);
    process.env.AGENT_HMAC_SECRETS_JSON = JSON.stringify({ agenteA: segredoA, agenteB: segredoB });
    const corpo = Buffer.from('{}');
    const timestamp = new Date().toISOString();
    const context = criarContexto(
      {
        'x-agent-id': 'agenteB',
        'x-timestamp': timestamp,
        'x-signature': assinar(timestamp, corpo, segredoB, 'agenteB'),
      },
      corpo,
    );
    expect(new HmacAuthGuard().canActivate(context)).toBe(true);
  });

  it('rejeita agente ausente do mapa de segredos', () => {
    process.env.AGENT_HMAC_SECRETS_JSON = JSON.stringify({ outro: 'x'.repeat(32) });
    const corpo = Buffer.from('{}');
    const timestamp = new Date().toISOString();
    const context = criarContexto(
      {
        'x-agent-id': 'desconhecido',
        'x-timestamp': timestamp,
        'x-signature': assinar(timestamp, corpo, 'z'.repeat(32), 'desconhecido'),
      },
      corpo,
    );
    expect(() => new HmacAuthGuard().canActivate(context)).toThrow(/não cadastrado/);
  });

  it('rejeita repetição de assinatura dentro da janela de tolerância (replay)', () => {
    const guard = new HmacAuthGuard();
    const corpo = Buffer.from('{}');
    const timestamp = new Date().toISOString();
    const assinatura = assinar(timestamp, corpo);
    const context = criarContexto(
      { 'x-agent-id': 'a1', 'x-timestamp': timestamp, 'x-signature': assinatura },
      corpo,
    );
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(/replay detectado/);
  });

  it('rejeita AGENT_HMAC_SECRET com menos de 32 bytes', () => {
    process.env.AGENT_HMAC_SECRET = 'segredo-muito-curto';
    const guard = new HmacAuthGuard();
    const corpo = Buffer.from('{}');
    const timestamp = new Date().toISOString();
    const context = criarContexto(
      { 'x-agent-id': 'a1', 'x-timestamp': timestamp, 'x-signature': '0'.repeat(64) },
      corpo,
    );
    expect(() => guard.canActivate(context)).toThrow(/no mínimo 32 bytes/);
  });
});
