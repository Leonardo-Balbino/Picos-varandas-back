import { Prisma } from '../generated/prisma/client';
import { money, toMoney } from './money';

describe('money (seção 3.2 — regra crítica de precisão decimal)', () => {
  it('reproduz o erro de ponto flutuante que motiva o helper, e mostra Decimal fechando exato', () => {
    // Exemplo real de imprecisão binária (não o par 206.00/6.00 citado só
    // como ilustração na seção 3.2 — esse par específico não sofre o
    // problema, 10.10 - 10.00 sofre): em ponto flutuante, isto NÃO fecha em
    // 0.10, e é exatamente esse tipo de erro que rejeitaria (422) uma
    // conciliação legítima se dinheiro fosse number/Float (Card D3).
    expect(10.1 - 10.0).not.toBe(0.1);

    const resultado = money(10.1).minus(money(10.0));
    expect(resultado.equals(money(0.1))).toBe(true);
  });

  it('.equals() é a comparação correta, nunca === (instâncias diferentes do mesmo valor)', () => {
    const a = money('33.80');
    const b = money(33.8);
    expect(a === (b as unknown as typeof a)).toBe(false); // instâncias distintas
    expect(a.equals(b)).toBe(true); // mesmo valor
  });

  it('valida a fórmula de conciliação do Card D3 (valorExtrato = valorPDV - taxa + ajuste)', () => {
    const valorPdv = money(206.0);
    const taxa = money(6.0);
    const ajuste = money(0);
    const valorExtrato = money(200.0);

    const calculado = valorPdv.minus(taxa).plus(ajuste);
    expect(calculado.equals(valorExtrato)).toBe(true);
  });

  it('detecta divergência de R$ 0,01 (critério de pronto do Card D3)', () => {
    const valorPdv = money(206.0);
    const taxa = money(6.0);
    const ajuste = money(0);
    const valorExtratoErrado = money(200.01);

    const calculado = valorPdv.minus(taxa).plus(ajuste);
    expect(calculado.equals(valorExtratoErrado)).toBe(false);
  });

  it('toMoney: converte Decimal para number só na borda, com 2 casas fixas', () => {
    expect(toMoney(new Prisma.Decimal('33.8'))).toBe(33.8);
    expect(toMoney(new Prisma.Decimal('100'))).toBe(100);
    expect(toMoney(null)).toBeNull();
  });
});
