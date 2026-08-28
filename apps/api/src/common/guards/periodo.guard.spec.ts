import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PeriodoGuard } from './periodo.guard';
import type { FechamentoService } from '../../modules/fechamento/fechamento.service';

function criarContexto(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PeriodoGuard (Card H2)', () => {
  it('libera sem checar nada quando a rota não tem @CompetenciaFrom', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const fechamentoService = { isCompetenciaFechada: jest.fn() } as unknown as FechamentoService;
    const guard = new PeriodoGuard(reflector, fechamentoService);

    await expect(guard.canActivate(criarContexto({ body: {} }))).resolves.toBe(true);
    expect(fechamentoService.isCompetenciaFechada).not.toHaveBeenCalled();
  });

  it('extrai a competência de body.<campo> e bloqueia com 422 PERIOD_LOCKED quando o mês está trancado', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('body.dataPagamento'),
    } as unknown as Reflector;
    const fechamentoService = {
      isCompetenciaFechada: jest.fn().mockResolvedValue(true),
    } as unknown as FechamentoService;
    const guard = new PeriodoGuard(reflector, fechamentoService);

    const request = { body: { dataPagamento: '2026-07-15' } };
    await expect(guard.canActivate(criarContexto(request))).rejects.toMatchObject({
      code: 'PERIOD_LOCKED',
    });
    expect(fechamentoService.isCompetenciaFechada).toHaveBeenCalledWith('2026-07');
  });

  it('libera quando o mês extraído não está trancado', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('params.competencia'),
    } as unknown as Reflector;
    const fechamentoService = {
      isCompetenciaFechada: jest.fn().mockResolvedValue(false),
    } as unknown as FechamentoService;
    const guard = new PeriodoGuard(reflector, fechamentoService);

    const request = { params: { competencia: '2026-08' } };
    await expect(guard.canActivate(criarContexto(request))).resolves.toBe(true);
  });

  it('libera (não bloqueia) quando o campo apontado está ausente do payload', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('body.dataPagamento'),
    } as unknown as Reflector;
    const fechamentoService = { isCompetenciaFechada: jest.fn() } as unknown as FechamentoService;
    const guard = new PeriodoGuard(reflector, fechamentoService);

    const request = { body: {} };
    await expect(guard.canActivate(criarContexto(request))).resolves.toBe(true);
    expect(fechamentoService.isCompetenciaFechada).not.toHaveBeenCalled();
  });
});
