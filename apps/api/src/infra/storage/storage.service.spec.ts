import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from './storage.service';

describe('StorageService (Card A4 — volume local)', () => {
  let diretorioTemporario: string;
  const OLD_STORAGE_DIR = process.env.STORAGE_DIR;

  beforeEach(async () => {
    diretorioTemporario = await mkdtemp(join(tmpdir(), 'varanda-storage-test-'));
    process.env.STORAGE_DIR = diretorioTemporario;
  });

  afterEach(async () => {
    process.env.STORAGE_DIR = OLD_STORAGE_DIR;
    await rm(diretorioTemporario, { recursive: true, force: true });
  });

  it('gerarChave segue a convenção <contexto>/<ano>/<mes>/<uuid>-<slug>', () => {
    const service = new StorageService();
    const chave = service.gerarChave('extrato', 'extrato-itau-agosto.csv');
    const partes = chave.split('/');
    expect(partes[0]).toBe('extrato');
    expect(partes[1]).toMatch(/^\d{4}$/);
    expect(partes[2]).toMatch(/^\d{2}$/);
    expect(partes[3]).toMatch(/^[0-9a-f-]{36}-extrato-itau-agosto\.csv$/);
  });

  it('gerarChave nunca usa o nome original cru quando ele tenta path traversal', () => {
    const service = new StorageService();
    const chave = service.gerarChave('comprovante', '../../../etc/passwd');
    expect(chave).not.toContain('..');
    expect(chave.split('/').length).toBe(4); // contexto/ano/mes/uuid-slug, nada a mais
  });

  it('gerarChave remove acentos e caracteres não seguros do nome original', () => {
    const service = new StorageService();
    const chave = service.gerarChave('extrato', 'extração são paulo (12).csv');
    const slug = chave.split('/')[3];
    expect(slug).not.toMatch(/[çãáéíóú()]/i);
  });

  it('salvar + ler faz round-trip exato do conteúdo', async () => {
    const service = new StorageService();
    const chave = service.gerarChave('extrato', 'arquivo.csv');
    const conteudoOriginal = Buffer.from('linha1\nlinha2\n', 'utf-8');

    await service.salvar(chave, conteudoOriginal);
    const lido = await service.ler(chave);

    expect(lido.equals(conteudoOriginal)).toBe(true);
  });

  it('remover apaga o arquivo — ler depois falha', async () => {
    const service = new StorageService();
    const chave = service.gerarChave('extrato', 'arquivo.csv');
    await service.salvar(chave, Buffer.from('conteúdo'));

    await service.remover(chave);

    await expect(service.ler(chave)).rejects.toThrow();
  });
});
