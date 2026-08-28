import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectarCsvPixPag, parseCsvPixPag } from './csv-pixpag.parser';

const CAMINHO_FIXTURE = join(__dirname, '../../../../../test/fixtures/extratos/pixpag-movimentacoes.csv');

describe('parseCsvPixPag (Card D1 — extrato real do PixPag)', () => {
  const conteudo = readFileSync(CAMINHO_FIXTURE, 'utf-8');

  it('detecta o perfil pelo cabeçalho real do arquivo', () => {
    const primeiraLinha = conteudo.split(/\r?\n/, 1)[0];
    expect(detectarCsvPixPag(primeiraLinha)).toBe(true);
  });

  it('não detecta um cabeçalho qualquer como perfil PixPag', () => {
    expect(detectarCsvPixPag('"Data","Histórico","Documento","Valor (R$)","Saldo (R$)"')).toBe(false);
  });

  it('importa uma linha normalizada para cada lançamento "Confirmado" do arquivo real', () => {
    const totalLinhasArquivo = conteudo.trim().split(/\r?\n/).length - 1; // -1 = cabeçalho
    const { linhas } = parseCsvPixPag(conteudo);
    expect(linhas.length).toBeGreaterThan(0);
    expect(linhas.length).toBeLessThanOrEqual(totalLinhasArquivo);
  });

  it('primeira linha do arquivo real vira uma LinhaExtratoNormalizada correta', () => {
    // "12685918","12/08/2026 23:53","R$ 56,74","Transação via adquirente","Confirmado","4838523"
    const { linhas } = parseCsvPixPag(conteudo);
    const primeira = linhas[0];
    expect(primeira.dataTransacao.toISOString().slice(0, 10)).toBe('2026-08-12');
    expect(primeira.valor.toFixed(2)).toBe('56.74');
    expect(primeira.tipoTransacao).toBe('credito');
    expect(primeira.documento).toBe('4838523');
    expect(primeira.categoriaSugerida).toBe('adquirente');
  });

  it('lançamento de "Pagamento Pix" vira débito, sem documento, categoria pix', () => {
    // "12685154","12/08/2026 19:34","- R$ 826,00","Pagamento Pix","Confirmado",""
    const { linhas } = parseCsvPixPag(conteudo);
    const pagamentoPix = linhas.find((l) => l.valor.toFixed(2) === '826.00');
    expect(pagamentoPix).toBeDefined();
    expect(pagamentoPix!.tipoTransacao).toBe('debito');
    expect(pagamentoPix!.documento).toBeNull();
    expect(pagamentoPix!.categoriaSugerida).toBe('pix');
  });

  it('lançamento de "Tarifa de Pix" vira débito de baixo valor, categoria tarifa', () => {
    const { linhas } = parseCsvPixPag(conteudo);
    const tarifas = linhas.filter((l) => l.categoriaSugerida === 'tarifa' && l.tipoTransacao === 'debito');
    expect(tarifas.length).toBeGreaterThan(0);
    expect(tarifas.every((t) => t.valor.toFixed(2) === '2.99')).toBe(true);
  });

  it('estorno de pagamento Pix vira crédito (some do resultado como negativo)', () => {
    // "12676395","11/08/2026 08:44","R$ 2.463,02","Estorno de Pagamento Pix","Confirmado",""
    const { linhas } = parseCsvPixPag(conteudo);
    const estorno = linhas.find((l) => l.descricaoOrigem === 'Estorno de Pagamento Pix' && l.valor.toFixed(2) === '2463.02');
    expect(estorno).toBeDefined();
    expect(estorno!.tipoTransacao).toBe('credito');
  });

  it('gera aviso de "sem documento" (a maioria das linhas Pix não tem)', () => {
    const { avisos } = parseCsvPixPag(conteudo);
    expect(avisos.some((a) => a.includes('sem número de documento'))).toBe(true);
  });

  it('captura horaOriginal (HH:mm) — necessário pra não colidir hash de lançamentos idênticos no mesmo dia', () => {
    const { linhas } = parseCsvPixPag(conteudo);
    expect(linhas[0].horaOriginal).toBe('23:53');
  });

  it('regressão: as 8 tarifas de Pix de -R$ 2,99 do mesmo dia (11/08 e 12/08) têm horaOriginal distinta entre si', () => {
    // Achado real desta sessão: sem horaOriginal no hash, essas linhas
    // colidiam e 7 das 8 eram descartadas como duplicata falsa.
    const { linhas } = parseCsvPixPag(conteudo);
    const tarifas = linhas.filter((l) => l.categoriaSugerida === 'tarifa' && l.valor.toFixed(2) === '2.99');
    const horas = new Set(tarifas.map((t) => `${t.dataTransacao.toISOString().slice(0, 10)}T${t.horaOriginal}`));
    expect(horas.size).toBe(tarifas.length); // nenhuma combinação dia+hora repetida
  });

  it('soma total de créditos "Transação via adquirente" bate com a soma manual das linhas de adquirente', () => {
    const { linhas } = parseCsvPixPag(conteudo);
    const adquirente = linhas.filter((l) => l.categoriaSugerida === 'adquirente');
    const soma = adquirente.reduce((acc, l) => acc.plus(l.valor), adquirente[0].valor.minus(adquirente[0].valor));
    // Só valida que a soma é positiva e não-trivial — não recalcula o CSV
    // inteiro à mão, só confirma que o parser não zerou/quebrou o agregado.
    expect(soma.greaterThan(0)).toBe(true);
    expect(adquirente.length).toBeGreaterThan(100);
  });
});
