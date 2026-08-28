import { parseDataCivilBr, parseValorMonetario } from './parse-utils';

describe('parseValorMonetario', () => {
  it('formato BR (PixPag): ponto milhar, vírgula decimal, positivo', () => {
    expect(parseValorMonetario('R$ 56,74', 'br').toFixed(2)).toBe('56.74');
    expect(parseValorMonetario('R$ 1.038,31', 'br').toFixed(2)).toBe('1038.31');
  });

  it('formato BR: negativo com espaço entre o sinal e "R$" ("- R$ 2,99")', () => {
    const valor = parseValorMonetario('- R$ 2,99', 'br');
    expect(valor.toFixed(2)).toBe('-2.99');
    expect(valor.isNegative()).toBe(true);
  });

  it('formato US (extrato bancário tradicional): vírgula milhar, ponto decimal', () => {
    expect(parseValorMonetario('R$ 84.25', 'us').toFixed(2)).toBe('84.25');
    expect(parseValorMonetario('R$ 1,246.00', 'us').toFixed(2)).toBe('1246.00');
  });

  it('formato US: negativo SEM espaço entre o sinal e "R$" ("-R$ 500.00")', () => {
    const valor = parseValorMonetario('-R$ 500.00', 'us');
    expect(valor.toFixed(2)).toBe('-500.00');
    expect(valor.isNegative()).toBe(true);
  });

  it('os mesmos 1000+X em BR e US não podem ser confundidos entre si', () => {
    // "R$ 1.038,31" (BR) = mil e trinta e oito reais. Se fosse lido como US
    // por engano, viraria 1.038 (mil ponto zero trinta e oito) — bug de
    // precisão silencioso, exatamente o que a seção 3.2 do documento adverte.
    const comoBr = parseValorMonetario('R$ 1.038,31', 'br');
    expect(comoBr.toFixed(2)).toBe('1038.31');
    expect(comoBr.toFixed(2)).not.toBe('1.04'); // não é isso se interpretado (errado) como US
  });
});

describe('parseDataCivilBr', () => {
  it('"DD/MM/YYYY" vira data civil UTC correta', () => {
    const data = parseDataCivilBr('12/08/2026');
    expect(data.getUTCFullYear()).toBe(2026);
    expect(data.getUTCMonth()).toBe(7); // agosto = índice 7
    expect(data.getUTCDate()).toBe(12);
  });

  it('"DD/MM/YYYY HH:mm" (PixPag) usa só a parte da data, hora é descartada', () => {
    const data = parseDataCivilBr('12/08/2026 23:53');
    expect(data.getUTCFullYear()).toBe(2026);
    expect(data.getUTCMonth()).toBe(7);
    expect(data.getUTCDate()).toBe(12);
    expect(data.getUTCHours()).toBe(0);
  });
});
