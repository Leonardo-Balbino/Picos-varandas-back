import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ProcessarExtratoInput, ProcessarExtratoResponse } from 'contracts';
import { ArquivosService } from '../../arquivos/arquivos.service';
import { FechamentoService } from '../../fechamento/fechamento.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { parseArquivoExtrato } from './parsers';
import type { LinhaExtratoNormalizada } from './parsers';

/**
 * Ingestão de extrato bancário (Card D1) — arquivo já enviado via Card A4
 * (`arquivoId`), aqui só processa. Regras da spec original mantidas:
 * gravação inteira em uma transação (falha no meio não deixa arquivo meio
 * importado), rejeição item a item por mês trancado sem abortar o lote,
 * idempotência por hash de duplicidade.
 *
 * DESVIO documentado da fórmula de hash da spec original
 * (`SHA-256(banco | conta | data_transacao | documento | valor |
 * tipo_transacao)`): esta implementação ACRESCENTA `descricaoOrigem` à
 * fórmula. Motivo, confirmado com dado real (não hipotético) nesta sessão:
 * nos dois formatos de extrato reais testados, a maioria dos lançamentos
 * (PIX RECEBIDO sem documento, no extrato bancário tradicional; e boa
 * parte das linhas do PixPag) vem com `documento` vazio. Sem a descrição
 * na fórmula, dois lançamentos DIFERENTES do mesmo dia com o mesmo valor e
 * sem documento colidiriam no hash e um seria descartado como duplicata
 * falsa — um bug de perda de dado silenciosa, pior que o problema que o
 * hash existe para resolver. Incluir a descrição não sacrifica nada da
 * garantia original (arquivo reenviado idêntico continua batendo hash
 * igual, zero linhas novas) e reduz drasticamente a chance de colisão.
 *
 * SEGUNDO desvio, também motivado por dado real: quando a fonte tem hora
 * disponível (`horaOriginal`, ver parsers/parse-utils.ts), ela também entra
 * no hash — mesmo `dataTransacao` sendo só data civil. Achado rodando o
 * arquivo real do PixPag nesta sessão: um único dia teve 8 lançamentos
 * "Tarifa de Pix" de -R$ 2,99 idênticos (mesma descrição, mesmo valor, sem
 * documento) — sem a hora no hash, 7 dessas 8 linhas REAIS colidiam e eram
 * descartadas como "duplicada" (perda de dado silenciosa, o pior desfecho
 * possível para uma reconciliação fiscal).
 */
@Injectable()
export class ExtratosService {
  private readonly logger = new Logger(ExtratosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly arquivosService: ArquivosService,
    private readonly fechamentoService: FechamentoService,
  ) {}

  async processar(input: ProcessarExtratoInput): Promise<ProcessarExtratoResponse> {
    const { registro, buffer } = await this.arquivosService.carregarParaProcessamento(
      input.arquivoId,
      'extrato',
    );

    const { linhas, avisos: avisosDoParser } = await parseArquivoExtrato(
      buffer,
      registro.mimeType,
      registro.nomeOriginal,
    );

    let importadas = 0;
    let duplicadas = 0;
    let rejeitadas = 0;
    const avisos = [...avisosDoParser];
    let dataMin: Date | null = null;
    let dataMax: Date | null = null;

    // Timeout explícito (60s), não o default de 5s do Prisma — mesmo
    // raciocínio do Card I1 para lotes grandes de vendas.
    await this.prisma.$transaction(
      async (tx) => {
        for (const linha of linhas) {
          if (!dataMin || linha.dataTransacao < dataMin) dataMin = linha.dataTransacao;
          if (!dataMax || linha.dataTransacao > dataMax) dataMax = linha.dataTransacao;

          const competencia = this.competenciaDeDataCivil(linha.dataTransacao);
          const fechado = await this.fechamentoService.isCompetenciaFechada(competencia);
          if (fechado) {
            rejeitadas++;
            avisos.push(
              `Lançamento de ${this.isoData(linha.dataTransacao)} (${linha.descricaoOrigem}) rejeitado: mês ${competencia} está trancado.`,
            );
            continue;
          }

          const hashDuplicidade = this.calcularHash(input.banco, input.conta, linha);

          // Checa-então-cria (não deixa o unique constraint estourar dentro
          // da transação): um erro de constraint no meio de uma transação
          // Postgres a envenena inteira (todo INSERT seguinte falharia até
          // um ROLLBACK), o que abortaria o lote inteiro por causa de UMA
          // duplicata — exatamente o que "duplicadas" como contador
          // separado (não erro) precisa evitar.
          const existente = await tx.extratoBancario.findUnique({ where: { hashDuplicidade } });
          if (existente) {
            duplicadas++;
            continue;
          }

          await tx.extratoBancario.create({
            data: {
              banco: input.banco,
              conta: input.conta,
              dataTransacao: linha.dataTransacao,
              descricaoOrigem: linha.descricaoOrigem,
              documento: linha.documento,
              tipoTransacao: linha.tipoTransacao,
              valor: linha.valor,
              categoria: linha.categoriaSugerida,
              hashDuplicidade,
              arquivoId: registro.id,
            },
          });
          importadas++;
        }
      },
      { timeout: 60_000 },
    );

    this.logger.log(
      `Extrato ${registro.id} (${registro.nomeOriginal}): ${linhas.length} lidas, ${importadas} importadas, ${duplicadas} duplicadas, ${rejeitadas} rejeitadas.`,
    );

    return {
      arquivoId: registro.id,
      lidas: linhas.length,
      importadas,
      duplicadas,
      rejeitadas,
      periodo: {
        inicio: dataMin ? this.isoData(dataMin) : null,
        fim: dataMax ? this.isoData(dataMax) : null,
      },
      avisos,
    };
  }

  private calcularHash(banco: string, conta: string, linha: LinhaExtratoNormalizada): string {
    const partes = [
      banco,
      conta,
      this.isoData(linha.dataTransacao),
      linha.documento ?? '',
      linha.valor.toFixed(2),
      linha.tipoTransacao,
      linha.descricaoOrigem,
      linha.horaOriginal ?? '',
    ];
    return createHash('sha256').update(partes.join('|')).digest('hex');
  }

  /** `dataTransacao` já é uma data civil (meia-noite UTC representando o
   * dia, não um instante — ver parse-utils.ts), então a competência sai
   * direto dos getters UTC, sem necessidade de conversão de fuso (essa
   * conversão só importa para INSTANTES, como em common/tz.ts). */
  private competenciaDeDataCivil(data: Date): string {
    return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private isoData(data: Date): string {
    return data.toISOString().slice(0, 10);
  }
}
