import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { createInflateRaw } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Injectable, Logger } from '@nestjs/common';
import type { FormaPagamento, IngerirVendasPdvInput, VendaPdvItemInput } from 'contracts';
import { VendasSyncService } from '../vendas/vendas-sync.service';

export interface ResultadoExtracao {
  totalVendas: number;
  totalCriadas: number;
  totalAtualizadas: number;
  totalIgnoradas: number;
  totalRejeitadas: number;
  tempoMs: number;
}

export interface ExtracaoOptions {
  dataInicio?: string;
  diasRetroativos?: number;
}

/**
 * Normaliza descrições e códigos do Dontec ERP para o enum FormaPagamento do Prisma.
 */
export function normalizarFormaPagamento(cod: string, desc: string): FormaPagamento {
  const texto = (desc || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

  if (texto.includes('PIX')) return 'pix';
  if (texto.includes('DINHEIRO') || texto.includes('ESPECIE')) return 'dinheiro';
  if (texto.includes('DEBIT')) return 'cartao_debito';
  if (texto.includes('CREDIT') || texto.includes('CARTAO')) return 'cartao_credito';
  if (
    texto.includes('VOUCHER') ||
    texto.includes('VALE') ||
    texto.includes('ALIMENTA') ||
    texto.includes('REFEIC') ||
    texto.includes('CONTA ASSINADA') ||
    texto.includes('CORTESIA')
  ) {
    return 'voucher';
  }
  return 'dinheiro';
}

/**
 * Converte data/hora naive do Firebird (America/Sao_Paulo) para UTC com indicador Z.
 * Exemplo: "2026-08-11 23:31:46.0000" -> "2026-08-12T02:31:46.000Z"
 */
export function firebirdDateToUtcIso(dateStr: string): string {
  const clean = dateStr.trim().slice(0, 19).replace(' ', 'T');
  // America/Sao_Paulo é UTC-3 desde o fim do horário de verão no Brasil
  const date = new Date(`${clean}-03:00`);
  if (isNaN(date.getTime())) {
    throw new Error(`Data/hora inválida do Firebird: ${dateStr}`);
  }
  return date.toISOString();
}

@Injectable()
export class BackupExtractorService {
  private readonly logger = new Logger(BackupExtractorService.name);

  constructor(private readonly vendasSyncService: VendasSyncService) {}

  /**
   * Extrai e ingere as vendas do banco Firebird contido no backup.
   * Suporta arquivos .zip, .rar ou o próprio .gdb/.fdb já descompactado.
   */
  async extrairEIngerir(
    upload: { id: string; nomeOrigem: string },
    caminhoArquivoOuDb: string,
    options?: ExtracaoOptions,
  ): Promise<ResultadoExtracao> {
    const inicio = Date.now();
    const pastaTrabalho = dirname(caminhoArquivoOuDb);
    let gdbPath = caminhoArquivoOuDb;

    const ehBancoDireto = /\.(gdb|fdb)$/i.test(caminhoArquivoOuDb);
    if (!ehBancoDireto) {
      const pastaDescompactacao = join(pastaTrabalho, 'descompactado');
      await mkdir(pastaDescompactacao, { recursive: true, mode: 0o700 });
      await this.descompactarBackup(caminhoArquivoOuDb, pastaDescompactacao);
      gdbPath = await this.localizarBancoFirebird(pastaDescompactacao);
    }

    this.logger.log(`Banco Firebird localizado para extração: ${gdbPath}`);

    const vendas = await this.executarConsultaFirebird(gdbPath, pastaTrabalho, options);
    this.logger.log(`Extraídas ${vendas.length} vendas do banco Firebird (${gdbPath}).`);

    let totalCriadas = 0;
    let totalAtualizadas = 0;
    let totalIgnoradas = 0;
    let totalRejeitadas = 0;

    const TAMANHO_LOTE = 400;
    const totalPartes = Math.max(1, Math.ceil(vendas.length / TAMANHO_LOTE));

    for (let parte = 1; parte <= totalPartes; parte++) {
      const fatia = vendas.slice((parte - 1) * TAMANHO_LOTE, parte * TAMANHO_LOTE);
      if (fatia.length === 0) break;

      const input: IngerirVendasPdvInput = {
        loteId: `backup-${upload.id}`,
        parteAtual: parte,
        totalPartes,
        vendas: fatia,
      };

      const resultadoLote = await this.vendasSyncService.ingerir(input);
      totalCriadas += resultadoLote.criadas;
      totalAtualizadas += resultadoLote.atualizadas;
      totalIgnoradas += resultadoLote.ignoradas;
      totalRejeitadas += resultadoLote.rejeitadas.length;
    }

    const tempoMs = Date.now() - inicio;
    return {
      totalVendas: vendas.length,
      totalCriadas,
      totalAtualizadas,
      totalIgnoradas,
      totalRejeitadas,
      tempoMs,
    };
  }

  /**
   * Descompacta o arquivo de backup usando comandos do sistema (python3 zipfile / unzip)
   * ou fallback para rotina interna.
   */
  async descompactarBackup(zipPath: string, destino: string): Promise<void> {
    // 1. Tenta python3 -m zipfile -e
    const extraiuPython = await this.executarComando('python3', ['-m', 'zipfile', '-e', zipPath, destino]);
    if (extraiuPython) return;

    // 2. Tenta unzip CLI
    const extraiuUnzip = await this.executarComando('unzip', ['-q', '-o', zipPath, '-d', destino]);
    if (extraiuUnzip) return;

    // 3. Fallback: Descompactador nativo Node.js para ZIP (Deflate)
    await this.descompactarZipNativo(zipPath, destino);
  }

  /**
   * Descompactador ZIP nativo em Node.js usando zlib (sem dependências externas).
   */
  private async descompactarZipNativo(zipPath: string, destino: string): Promise<void> {
    const buffer = await readFile(zipPath);
    let offset = 0;

    while (offset < buffer.length - 30) {
      const signature = buffer.readUInt32LE(offset);
      if (signature !== 0x04034b50) {
        // Encerra ao sair das seções de Local File Header (ex: Central Directory)
        break;
      }

      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const _uncompressedSize = buffer.readUInt32LE(offset + 22);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraFieldLength = buffer.readUInt16LE(offset + 28);

      const fileName = buffer
        .subarray(offset + 30, offset + 30 + fileNameLength)
        .toString('utf8');

      const dataStart = offset + 30 + fileNameLength + extraFieldLength;
      const dataEnd = dataStart + compressedSize;

      if (!fileName.endsWith('/') && !fileName.endsWith('\\')) {
        const filePath = join(destino, fileName);
        await mkdir(dirname(filePath), { recursive: true });

        if (compressionMethod === 0) {
          // Stored (sem compressão)
          await writeFile(filePath, buffer.subarray(dataStart, dataEnd));
        } else if (compressionMethod === 8) {
          // Deflate
          const compressed = buffer.subarray(dataStart, dataEnd);
          const writeStream = createWriteStream(filePath, { mode: 0o600 });
          const inflate = createInflateRaw();
          const { Readable } = await import('node:stream');
          await pipeline(Readable.from(compressed), inflate, writeStream);
        } else {
          throw new Error(`Método de compressão ZIP ${compressionMethod} não suportado para ${fileName}.`);
        }
      }

      offset = dataEnd;
    }
  }

  /**
   * Localiza o arquivo de banco Firebird (.GDB / .FDB) dentro do diretório extraído.
   */
  async localizarBancoFirebird(diretorio: string): Promise<string> {
    const arquivos: string[] = [];

    const varrer = async (dir: string): Promise<void> => {
      const entradas = await readdir(dir, { withFileTypes: true });
      for (const entrada of entradas) {
        const caminhoCompleto = join(dir, entrada.name);
        if (entrada.isDirectory()) {
          await varrer(caminhoCompleto);
        } else if (/\.(gdb|fdb)$/i.test(entrada.name)) {
          arquivos.push(caminhoCompleto);
        }
      }
    };

    await varrer(diretorio);

    if (arquivos.length === 0) {
      throw new Error(`Nenhum arquivo de banco Firebird (.GDB ou .FDB) encontrado em ${diretorio}.`);
    }

    // Se houver mais de um, escolhe o de maior tamanho (o banco principal)
    let maiorArquivo = arquivos[0];
    let maiorTamanho = 0;
    for (const arq of arquivos) {
      const s = await stat(arq);
      if (s.size > maiorTamanho) {
        maiorTamanho = s.size;
        maiorArquivo = arq;
      }
    }

    return maiorArquivo;
  }

  /**
   * Localiza a instalação e os binários do Firebird 2.5.
   */
  obterConfiguracaoFirebird(): { isqlPath: string; firebirdRoot: string; libPath: string } {
    const homeDir = process.env.HOME ?? '';
    const caminhos = [
      process.env.FIREBIRD_PATH,
      homeDir ? join(homeDir, '.local', 'share', 'firebird25') : undefined,
      '/opt/firebird',
      '/tmp/fb25/cs_root/opt/firebird',
      '/usr/lib/firebird/2.5',
      '/usr/local/firebird',
    ].filter((c): c is string => Boolean(c && existsSync(c)));

    for (const root of caminhos) {
      const isql = join(root, 'bin', 'isql');
      if (existsSync(isql)) {
        return {
          isqlPath: isql,
          firebirdRoot: root,
          libPath: join(root, 'lib'),
        };
      }
    }

    throw new Error(
      'Instalação do Firebird 2.5 (isql) não encontrada. Configure a variável de ambiente FIREBIRD_PATH.',
    );
  }

  /**
   * Executa a consulta SQL no banco Firebird via isql e faz o parse das linhas extraídas.
   */
  async executarConsultaFirebird(
    gdbPath: string,
    pastaTrabalho: string,
    options?: ExtracaoOptions,
  ): Promise<VendaPdvItemInput[]> {
    const { isqlPath, firebirdRoot, libPath } = this.obterConfiguracaoFirebird();

    // Filtro de data: se explicitado ou por padrão 2026-01-01
    let filtroData = '';
    if (options?.dataInicio) {
      filtroData = `AND N.DATA_HORA_VENDA >= '${options.dataInicio}'`;
    } else if (options?.diasRetroativos) {
      const dt = new Date(Date.now() - options.diasRetroativos * 86_400_000);
      const isoLocal = dt.toISOString().slice(0, 10) + ' 00:00:00';
      filtroData = `AND N.DATA_HORA_VENDA >= '${isoLocal}'`;
    } else if (process.env.BACKUP_EXTRACT_ALL !== 'true') {
      const dataInicioPadrao = process.env.BACKUP_EXTRACTION_SINCE ?? '2026-01-01 00:00:00';
      filtroData = `AND N.DATA_HORA_VENDA >= '${dataInicioPadrao}'`;
    }

    const scriptSql = `
SET HEADING OFF;
SET LIST OFF;
SELECT
    F.SEQ_FORMA_NOTAS || '|' ||
    N.COD_EMPRESA || '|' ||
    N.COD_TIPO_OPERACAO || '|' ||
    N.NR_NOTA || '|' ||
    TRIM(N.SERIE) || '|' ||
    N.COD_PESSOA || '|' ||
    N.DATA_EMISSAO || '|' ||
    COALESCE(N.CUPOMIMPRESSO, N.CUPOM, N.NR_NOTA) || '|' ||
    N.DATA_HORA_VENDA || '|' ||
    COALESCE(F.VALOR, F.VALOR_PAGO, 0) || '|' ||
    TRIM(F.COD_FORMA_PGTO) || '|' ||
    TRIM(COALESCE(P.DESCRICAO, '')) || '|' ||
    TRIM(COALESCE(F.TEFNROAUTO, '')) || '|' ||
    TRIM(COALESCE(F.PIXE2E, '')) || '|' ||
    CASE 
        WHEN N.DATA_CANC IS NOT NULL OR N.DATA_CANCELA_NFE IS NOT NULL THEN 1 
        ELSE 0 
    END
FROM NOTAS_CAB N
JOIN FORMAS_NOTAS F
  ON F.COD_EMPRESA = N.COD_EMPRESA
 AND F.COD_TIPO_OPERACAO = N.COD_TIPO_OPERACAO
 AND F.NR_NOTA = N.NR_NOTA
 AND F.SERIE = N.SERIE
 AND F.COD_PESSOA = N.COD_PESSOA
 AND F.DATA_EMISSAO = N.DATA_EMISSAO
JOIN TIPO_OPERACAO T
  ON T.COD_EMPRESA = N.COD_EMPRESA
 AND T.COD_TIPO_OPERACAO = N.COD_TIPO_OPERACAO
LEFT JOIN FORMA_PGTO P 
  ON P.COD_FORMA_PGTO = F.COD_FORMA_PGTO
WHERE UPPER(COALESCE(T.TIPO_NATUREZA, '')) = 'V'
  AND UPPER(COALESCE(T.GERA_FINANCEIRO, 'N')) = 'S'
  AND COALESCE(F.VALOR, F.VALOR_PAGO, 0) > 0
  ${filtroData}
ORDER BY N.DATA_HORA_VENDA ASC, F.SEQ_FORMA_NOTAS ASC;
QUIT;
`;

    const scriptPath = join(pastaTrabalho, `query_${Date.now()}.sql`);
    await writeFile(scriptPath, scriptSql, 'utf8');

    try {
      const vendas = await new Promise<VendaPdvItemInput[]>((resolve, reject) => {
        const proc = spawn(
          isqlPath,
          [gdbPath, '-u', 'SYSDBA', '-p', 'masterkey', '-m', '-pag', '0', '-i', scriptPath],
          {
            env: {
              ...process.env,
              FIREBIRD: firebirdRoot,
              LD_LIBRARY_PATH: libPath,
            },
          },
        );

        const lista: VendaPdvItemInput[] = [];
        const erros: string[] = [];

        const rl = createInterface({ input: proc.stdout });
        rl.on('line', (rawLine) => {
          const linha = rawLine.trim();
          if (!linha || !linha.includes('|')) return;

          const partes = linha.split('|');
          if (partes.length < 15) return;

          const seqForma = partes[0].trim();
          const codEmpresa = partes[1].trim();
          const codOperacao = partes[2].trim();
          const nrNota = partes[3].trim();
          const serie = partes[4].trim();
          const codPessoa = partes[5].trim();
          const dtEmissao = partes[6].trim();
          const cupom = partes[7].trim();
          const dataHoraStr = partes[8].trim();
          const valorStr = partes[9].trim();
          const codForma = partes[10].trim();
          const descForma = partes[11].trim();
          const _tef = partes[12].trim();
          const _pixE2e = partes[13].trim();
          const cancelada = partes[14].trim() === '1';

          try {
            const dataHoraIso = firebirdDateToUtcIso(dataHoraStr);
            const valor = Number(valorStr);
            const forma = normalizarFormaPagamento(codForma, descForma);
            const idExterno = `varanda-pag:${codEmpresa}:${codOperacao}:${nrNota}:${serie}:${codPessoa}:${dtEmissao}:${seqForma}`;

            lista.push({
              idExterno,
              numeroCupom: cupom || nrNota,
              dataHora: dataHoraIso,
              valorBruto: valor,
              valorDesconto: 0,
              valorLiquido: valor,
              formaPagamento: forma,
              cancelada,
            });
          } catch {
            // Ignora linhas de cabeçalho residual ou dados corrompidos individuais
          }
        });

        proc.stderr.on('data', (d: Buffer) => {
          erros.push(d.toString());
        });

        proc.on('error', (err) => reject(err));
        proc.on('close', (code) => {
          if (code !== 0) {
            const detalhe = erros.join('\n').trim();
            reject(new Error(`isql falhou com código ${code}: ${detalhe}`));
          } else {
            resolve(lista);
          }
        });
      });

      return vendas;
    } finally {
      await rm(scriptPath, { force: true }).catch(() => undefined);
    }
  }

  private async executarComando(comando: string, args: string[]): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        const proc = spawn(comando, args, { stdio: 'ignore' });
        proc.on('error', () => resolve(false));
        proc.on('close', (code) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });
  }
}
