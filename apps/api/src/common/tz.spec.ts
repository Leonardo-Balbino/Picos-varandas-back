import { competenciaEmFusoLoja, dataCivilEmFusoLoja } from './tz';

describe('tz (seção 3.3 — conversão de fuso America/Sao_Paulo)', () => {
  it('venda às 22:30 BRT do dia 31 (01:30 UTC do dia 1) cai no dia/mês civil corretos (BRT), não em UTC', () => {
    // Cenário do critério de pronto do Card C1 e da nota da seção 3.3.
    // BRT = UTC-3 (sem horário de verão desde 2019): 2026-08-31T22:30
    // America/Sao_Paulo === 2026-09-01T01:30Z.
    const instante = new Date('2026-09-01T01:30:00Z');

    expect(dataCivilEmFusoLoja(instante)).toBe('2026-08-31');
    expect(competenciaEmFusoLoja(instante)).toBe('2026-08');
  });

  it('instante bem no meio do dia (sem risco de virada) cai no mesmo dia em BRT e UTC', () => {
    const instante = new Date('2026-08-10T15:00:00Z'); // 12:00 BRT
    expect(dataCivilEmFusoLoja(instante)).toBe('2026-08-10');
    expect(competenciaEmFusoLoja(instante)).toBe('2026-08');
  });
});
