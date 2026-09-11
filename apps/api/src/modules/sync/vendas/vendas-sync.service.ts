import { Injectable, Logger } from '@nestjs/common';
import type { IngerirVendasPdvInput, IngerirVendasPdvResponse, VendaRejeitada } from 'contracts';
import { money } from '../../../common/money';
import { competenciaEmFusoLoja } from '../../../common/tz';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { FechamentoService } from '../../fechamento/fechamento.service';

/**
 * Ingestão de vendas do PDV local (Card I1). Upsert por idExterno — nunca
 * abortado por venda individual inválida de negócio (mês trancado): essas
 * são rejeitadas uma a uma em `rejeitadas`, o lote inteiro segue.
 *
 * Duas regras não-negociáveis do card, ambas aplicadas por item:
 * 1. Nunca sobrescrever venda já conciliada — o PDV local não tem
 *    autoridade para desfazer trabalho de conciliação feito na nuvem.
 * 2. Venda cuja competência (fuso da loja, seção 3.3) está trancada é
 *    rejeitada, não gravada — mesma regra que o PeriodoGuard aplicaria a
 *    uma rota de usuário humano, só que aqui item a item dentro de um lote,
 *    por isso a checagem é chamada diretamente em vez de via o guard
 *    genérico (que opera na requisição inteira, não por item do corpo).
 */
@Injectable()
export class VendasSyncService {
  private readonly logger = new Logger(VendasSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fechamentoService: FechamentoService,
  ) {}

  async ingerir(input: IngerirVendasPdvInput): Promise<IngerirVendasPdvResponse> {
    const rejeitadas: VendaRejeitada[] = [];
    let criadas = 0;
    let atualizadas = 0;
    let ignoradas = 0;

    // Timeout explícito (60s), não o default de 5s do Prisma — mesmo
    // raciocínio do Card D1 para importação de extratos: um lote de até
    // 500 vendas não cabe folgadamente no default.
    await this.prisma.$transaction(
      async (tx) => {
        for (const item of input.vendas) {
          const dataHora = new Date(item.dataHora);
          const competencia = competenciaEmFusoLoja(dataHora);

          const fechado = await this.fechamentoService.isCompetenciaFechada(competencia);
          if (fechado) {
            rejeitadas.push({ idExterno: item.idExterno, motivo: 'PERIOD_LOCKED', competencia });
            continue;
          }

          const existente = await tx.vendaPdv.findUnique({
            where: { idExternoPdv: item.idExterno },
          });

          if (item.cancelada) {
            if (existente?.statusConciliacao === 'pendente') {
              await tx.vendaPdv.delete({ where: { id: existente.id } });
              atualizadas++;
            } else if (existente) {
              rejeitadas.push({
                idExterno: item.idExterno,
                motivo: 'CANCELLED_AFTER_RECONCILIATION',
                competencia,
              });
            } else {
              ignoradas++;
            }
            continue;
          }

          if (existente && existente.statusConciliacao !== 'pendente') {
            // Regra 1 — nunca sobrescrever venda já conciliada.
            ignoradas++;
            continue;
          }

          const dadosComuns = {
            numeroCupom: item.numeroCupom,
            dataHora,
            valorBruto: money(item.valorBruto),
            valorDesconto: money(item.valorDesconto ?? 0),
            valorLiquido: money(item.valorLiquido),
            formaPagamento: item.formaPagamento,
            bandeira: item.bandeira ?? null,
            sincronizadoEm: new Date(),
          };

          if (existente) {
            await tx.vendaPdv.update({ where: { id: existente.id }, data: dadosComuns });
            atualizadas++;
          } else {
            await tx.vendaPdv.create({
              data: { idExternoPdv: item.idExterno, ...dadosComuns },
            });
            criadas++;
          }
        }

        // Um registro por parte recebida (seção do Card I1), não por lote
        // inteiro — `input.loteId` identifica o lote, `parteAtual` (na
        // resposta, não persistido aqui) identifica qual fatia foi esta
        // chamada.
        await tx.agenteSyncLog.create({
          data: {
            loteId: input.loteId,
            tipoEvento: 'sync_vendas_pdv',
            registrosRecebidos: input.vendas.length,
            registrosCriados: criadas,
            registrosAtualizados: atualizadas,
            status: rejeitadas.length > 0 ? 'parcial' : 'sucesso',
            erroDetalhe:
              rejeitadas.length > 0
                ? `${rejeitadas.length} transação(ões) rejeitada(s): ${[
                    ...new Set(rejeitadas.map((item) => item.motivo)),
                  ].join(', ')}`
                : null,
          },
        });
      },
      { timeout: 60_000 },
    );

    this.logger.log(
      `Lote ${input.loteId} parte ${input.parteAtual}/${input.totalPartes}: ` +
        `${criadas} criadas, ${atualizadas} atualizadas, ${ignoradas} ignoradas, ${rejeitadas.length} rejeitadas.`,
    );

    return {
      loteId: input.loteId,
      parteAtual: input.parteAtual,
      recebidas: input.vendas.length,
      criadas,
      atualizadas,
      ignoradas,
      rejeitadas,
    };
  }
}
