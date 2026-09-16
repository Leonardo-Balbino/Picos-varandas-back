import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BackupExtractorService,
  firebirdDateToUtcIso,
  normalizarFormaPagamento,
} from './backup-extractor.service';
import type { VendasSyncService } from '../vendas/vendas-sync.service';

describe('BackupExtractorService', () => {
  let service: BackupExtractorService;
  let mockVendasSyncService: Partial<VendasSyncService>;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'extractor-test-'));
    mockVendasSyncService = {
      ingerir: jest.fn().mockResolvedValue({
        loteId: 'teste',
        parteAtual: 1,
        recebidas: 1,
        criadas: 1,
        atualizadas: 0,
        ignoradas: 0,
        rejeitadas: [],
      }),
    };
    service = new BackupExtractorService(mockVendasSyncService as VendasSyncService);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  describe('normalizarFormaPagamento', () => {
    it('reconhece PIX', () => {
      expect(normalizarFormaPagamento('19', 'PIX')).toBe('pix');
      expect(normalizarFormaPagamento('19', 'PAGAMENTO PIX')).toBe('pix');
    });

    it('reconhece Crédito e Débito', () => {
      expect(normalizarFormaPagamento('03', 'CREDITO')).toBe('cartao_credito');
      expect(normalizarFormaPagamento('03', 'CARTAO CREDITO')).toBe('cartao_credito');
      expect(normalizarFormaPagamento('02', 'DEBITO')).toBe('cartao_debito');
      expect(normalizarFormaPagamento('02', 'CARTAO DEBITO')).toBe('cartao_debito');
    });

    it('reconhece Dinheiro e Espécie', () => {
      expect(normalizarFormaPagamento('01', 'DINHEIRO')).toBe('dinheiro');
      expect(normalizarFormaPagamento('01', 'EM ESPECIE')).toBe('dinheiro');
    });

    it('reconhece Voucher, Cortesias e Conta Assinada', () => {
      expect(normalizarFormaPagamento('29', 'VOUCHER')).toBe('voucher');
      expect(normalizarFormaPagamento('29', 'VALE REFEICAO')).toBe('voucher');
      expect(normalizarFormaPagamento('18', 'CONTA ASSINADA')).toBe('voucher');
      expect(normalizarFormaPagamento('15', 'CORTESIA')).toBe('voucher');
    });
  });

  describe('firebirdDateToUtcIso', () => {
    it('converte data/hora naive de São Paulo para ISO UTC', () => {
      // 23:31:46 em UTC-3 vira 02:31:46 do dia seguinte em UTC
      const iso = firebirdDateToUtcIso('2026-08-11 23:31:46.0000');
      expect(iso).toBe('2026-08-12T02:31:46.000Z');
    });

    it('rejeita valores malformados', () => {
      expect(() => firebirdDateToUtcIso('invalido')).toThrow('Data/hora inválida do Firebird');
    });
  });

  describe('localizarBancoFirebird', () => {
    it('encontra o arquivo .gdb principal', async () => {
      const gdb1 = join(directory, 'VARANDA.GDB');
      const gdb2 = join(directory, 'MENOR.FDB');
      await writeFile(gdb1, Buffer.alloc(2048));
      await writeFile(gdb2, Buffer.alloc(1024));

      const encontrado = await service.localizarBancoFirebird(directory);
      expect(encontrado).toBe(gdb1);
    });

    it('lança erro se nenhum banco for encontrado', async () => {
      await writeFile(join(directory, 'leia-me.txt'), 'conteudo');
      await expect(service.localizarBancoFirebird(directory)).rejects.toThrow(
        'Nenhum arquivo de banco Firebird (.GDB ou .FDB) encontrado',
      );
    });
  });

  describe('extrairEIngerir com mock', () => {
    it('fatía em lotes de 400 e chama vendasSyncService.ingerir', async () => {
      const gdbFake = join(directory, 'BANCO.GDB');
      await writeFile(gdbFake, 'dados fake');

      // Espia o método executarConsultaFirebird
      const vendasFake = Array.from({ length: 450 }, (_, i) => ({
        idExterno: `varanda-pag:2:115:${i}:SC:1:2026-08-11:${i}`,
        numeroCupom: `${i}`,
        dataHora: '2026-08-11T20:00:00.000Z',
        valorBruto: 50.0,
        valorLiquido: 50.0,
        formaPagamento: 'pix' as const,
        cancelada: false,
      }));

      jest.spyOn(service, 'executarConsultaFirebird').mockResolvedValue(vendasFake);

      const resultado = await service.extrairEIngerir(
        { id: 'upload-123', nomeOrigem: 'backup.gdb' },
        gdbFake,
      );

      expect(resultado.totalVendas).toBe(450);
      expect(resultado.totalCriadas).toBe(2); // 2 lotes chamados (400 + 50)
      expect(mockVendasSyncService.ingerir).toHaveBeenCalledTimes(2);
      expect(mockVendasSyncService.ingerir).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          loteId: 'backup-upload-123',
          parteAtual: 1,
          totalPartes: 2,
        }),
      );
      expect(mockVendasSyncService.ingerir).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          loteId: 'backup-upload-123',
          parteAtual: 2,
          totalPartes: 2,
        }),
      );
    });

    it('extrai vendas reais do VARANDA672.GDB diretamente via isql se o banco existir', async () => {
      const { existsSync } = await import('node:fs');
      const realGdb = '/home/leovini/projetos/Picos-Varandas/VARANDA672.GDB';
      if (!existsSync(realGdb)) return;

      const vendas = await service.executarConsultaFirebird(realGdb, directory, {
        dataInicio: '2026-08-01 00:00:00',
      });
      expect(vendas.length).toBeGreaterThan(1000);
      expect(vendas[0].idExterno).toMatch(/^varanda-pag:\d+:\d+:/);
      expect(vendas[0].valorBruto).toBeGreaterThan(0);
      expect(vendas[0].dataHora).toMatch(/Z$/);
    });

    it('descompacta arquivo .zip real e localiza o banco Firebird dentro dele', async () => {
      // Cria uma pasta com um arquivo .gdb simulado
      const pastaOrigem = join(directory, 'origem');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(pastaOrigem, { recursive: true });
      const gdbOriginal = join(pastaOrigem, 'VARANDA888.GDB');
      await writeFile(gdbOriginal, 'conteudo-banco-firebird-simulado');

      // Cria um zip com python3
      const zipPath = join(directory, 'VARANDA888.zip');
      const { spawnSync } = await import('node:child_process');
      spawnSync('python3', ['-m', 'zipfile', '-c', zipPath, gdbOriginal]);

      // Descompacta usando o serviço
      const pastaDestino = join(directory, 'extraido');
      await mkdir(pastaDestino, { recursive: true });
      await service.descompactarBackup(zipPath, pastaDestino);

      // Localiza o banco
      const bancoLocalizado = await service.localizarBancoFirebird(pastaDestino);
      expect(bancoLocalizado).toMatch(/VARANDA888\.GDB$/);
    });
  });
});
