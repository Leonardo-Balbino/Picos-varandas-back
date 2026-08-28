import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectarXlsxBancoTradicional, parseXlsxBancoTradicional } from './xlsx-banco-tradicional.parser';

const CAMINHO_FIXTURE = join(__dirname, '../../../../../test/fixtures/extratos/banco-pj-agencia-conta.xlsx');

describe('parseXlsxBancoTradicional (Card D1 — extrato bancário real, planilha PJ)', () => {
  const buffer = readFileSync(CAMINHO_FIXTURE);

  it('detecta o perfil pela planilha real (cabeçalho depois do metadado de agência/conta)', () => {
    expect(detectarXlsxBancoTradicional(buffer)).toBe(true);
  });

  it('não detecta um buffer que não é uma planilha deste perfil', () => {
    expect(detectarXlsxBancoTradicional(Buffer.from('não é um xlsx'))).toBe(false);
  });

  it('importa as 40 linhas de lançamento (43 linhas da planilha - 3 de metadado/cabeçalho)', () => {
    const { linhas } = parseXlsxBancoTradicional(buffer);
    expect(linhas.length).toBe(40);
  });

  it('primeira linha de dado vira LinhaExtratoNormalizada correta', () => {
    // "12/08/2026","PIX RECEBIDO  66550637368","","R$ 84.25","R$ 21,766.45"
    const { linhas } = parseXlsxBancoTradicional(buffer);
    const primeira = linhas[0];
    expect(primeira.dataTransacao.toISOString().slice(0, 10)).toBe('2026-08-12');
    expect(primeira.valor.toFixed(2)).toBe('84.25');
    expect(primeira.tipoTransacao).toBe('credito');
    expect(primeira.documento).toBeNull();
    expect(primeira.categoriaSugerida).toBe('pix');
    expect(primeira.descricaoOrigem).toContain('PIX RECEBIDO');
  });

  it('"PIX ENVIADO" com valor negativo (formato US "-R$ 500.00") vira débito', () => {
    const { linhas } = parseXlsxBancoTradicional(buffer);
    const enviado = linhas.find((l) => l.descricaoOrigem.startsWith('PIX ENVIADO'));
    expect(enviado).toBeDefined();
    expect(enviado!.tipoTransacao).toBe('debito');
    expect(enviado!.valor.toFixed(2)).toBe('500.00');
  });

  it('valor com milhar no formato US ("R$ 1,246.00") é parseado como 1246.00, não 1.246', () => {
    const { linhas } = parseXlsxBancoTradicional(buffer);
    const milhar = linhas.find((l) => l.valor.toFixed(2) === '1246.00');
    expect(milhar).toBeDefined();
  });

  it('"ANTECIPACAO GETNET" (linha com Documento preenchido) captura o documento', () => {
    const { linhas } = parseXlsxBancoTradicional(buffer);
    const antecipacao = linhas.find((l) => l.descricaoOrigem.startsWith('ANTECIPACAO GETNET'));
    expect(antecipacao).toBeDefined();
    expect(antecipacao!.documento).toBe('5311116346');
    expect(antecipacao!.categoriaSugerida).toBe('adquirente');
    expect(antecipacao!.tipoTransacao).toBe('credito');
  });

  it('"TARIFA PIX RECEBIDO QR CHECKOUT" vira débito de categoria tarifa', () => {
    const { linhas } = parseXlsxBancoTradicional(buffer);
    const tarifa = linhas.find((l) => l.descricaoOrigem.startsWith('TARIFA'));
    expect(tarifa).toBeDefined();
    expect(tarifa!.tipoTransacao).toBe('debito');
    expect(tarifa!.categoriaSugerida).toBe('tarifa');
  });

  it('horaOriginal é sempre null nesta fonte (planilha só tem data, sem hora)', () => {
    const { linhas } = parseXlsxBancoTradicional(buffer);
    expect(linhas.every((l) => l.horaOriginal === null)).toBe(true);
  });

  it('a coluna "Saldo (R$)" nunca vaza para o resultado normalizado', () => {
    const { linhas } = parseXlsxBancoTradicional(buffer);
    for (const linha of linhas) {
      expect(Object.keys(linha)).not.toContain('saldo');
    }
  });
});
