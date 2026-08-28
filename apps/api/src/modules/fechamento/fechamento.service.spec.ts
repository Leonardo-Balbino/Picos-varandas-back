import { FechamentoService } from './fechamento.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';

/** Mock mínimo do PrismaService — só o que FechamentoService toca. */
function criarPrismaMock(trancado: boolean) {
  return {
    fechamentoMensal: {
      findUnique: jest.fn().mockResolvedValue({ trancado }),
    },
  } as unknown as PrismaService;
}

describe('FechamentoService (Card H2-infra — guard de período)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retorna true para mês trancado e false para mês aberto/inexistente', async () => {
    const prismaTrancado = criarPrismaMock(true);
    const servicoTrancado = new FechamentoService(prismaTrancado);
    await expect(servicoTrancado.isCompetenciaFechada('2026-07')).resolves.toBe(true);

    const prismaAberto = criarPrismaMock(false);
    const servicoAberto = new FechamentoService(prismaAberto);
    await expect(servicoAberto.isCompetenciaFechada('2026-08')).resolves.toBe(false);
  });

  it('usa o cache de 60s — segunda chamada dentro da janela não consulta o banco de novo', async () => {
    const prisma = criarPrismaMock(true);
    const service = new FechamentoService(prisma);

    await service.isCompetenciaFechada('2026-07');
    await service.isCompetenciaFechada('2026-07');

    expect((prisma.fechamentoMensal.findUnique as jest.Mock).mock.calls.length).toBe(1);
  });

  it('expira o cache após 60s e consulta o banco novamente', async () => {
    const prisma = criarPrismaMock(true);
    const service = new FechamentoService(prisma);

    await service.isCompetenciaFechada('2026-07');
    jest.advanceTimersByTime(60_001);
    await service.isCompetenciaFechada('2026-07');

    expect((prisma.fechamentoMensal.findUnique as jest.Mock).mock.calls.length).toBe(2);
  });

  it('invalidarCache força nova consulta antes dos 60s (efeito imediato de trancar/destrancar)', async () => {
    const prisma = criarPrismaMock(true);
    const service = new FechamentoService(prisma);

    await service.isCompetenciaFechada('2026-07');
    service.invalidarCache('2026-07');
    await service.isCompetenciaFechada('2026-07');

    expect((prisma.fechamentoMensal.findUnique as jest.Mock).mock.calls.length).toBe(2);
  });

  it('consulta pela chave composta {ano, mes} extraída da competência AAAA-MM', async () => {
    const prisma = criarPrismaMock(false);
    const service = new FechamentoService(prisma);

    await service.isCompetenciaFechada('2026-07');

    expect(prisma.fechamentoMensal.findUnique).toHaveBeenCalledWith({
      where: { ano_mes: { ano: 2026, mes: 7 } },
      select: { trancado: true },
    });
  });
});
