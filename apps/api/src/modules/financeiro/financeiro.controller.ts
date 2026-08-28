import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type {
  ContaPagarListaResposta,
  ContaPagarResposta,
  ContaReceberListaResposta,
  MovimentacaoCaixaListaResposta,
  MovimentacaoCaixaResposta,
  SaldoCaixaResposta,
} from 'contracts';
import { Audita } from '../../common/decorators/audita.decorator';
import { CompetenciaFrom } from '../../common/decorators/competencia-from.decorator';
import type { RequestWithUser } from '../../common/types/request-with-user';
import { AtualizarContaPagarDto } from './dto/atualizar-conta-pagar.dto';
import { CriarContaPagarDto } from './dto/criar-conta-pagar.dto';
import { CriarMovimentacaoCaixaDto } from './dto/criar-movimentacao-caixa.dto';
import { ListarContasPagarDto } from './dto/listar-contas-pagar.dto';
import { ListarContasReceberDto } from './dto/listar-contas-receber.dto';
import { ListarMovimentacoesCaixaDto } from './dto/listar-movimentacoes-caixa.dto';
import { PagarContaPagarDto } from './dto/pagar-conta-pagar.dto';
import { FinanceiroService } from './financeiro.service';

/** Contas a pagar (E1/E2), contas a receber (F1) e caixa físico (G1) — sem
 * `@Roles`: lançamento financeiro é operação do dia a dia, não restrita a
 * admin (RBAC de dois níveis, seção 3.9). */
@Controller('financeiro')
export class FinanceiroController {
  constructor(private readonly financeiroService: FinanceiroService) {}

  @Get('contas-pagar')
  async listarContasPagar(@Query() query: ListarContasPagarDto): Promise<ContaPagarListaResposta> {
    return this.financeiroService.listarContasPagar(query);
  }

  @Audita('contas_pagar')
  @CompetenciaFrom('body.dataVencimento')
  @Post('contas-pagar')
  async criarContaPagar(
    @Body() dto: CriarContaPagarDto,
    @Req() req: RequestWithUser,
  ): Promise<ContaPagarResposta> {
    return this.financeiroService.criarContaPagar(dto, req.user.id);
  }

  @Audita('contas_pagar')
  @CompetenciaFrom('body.dataVencimento')
  @Patch('contas-pagar/:id')
  async atualizarContaPagar(
    @Param('id') id: string,
    @Body() dto: AtualizarContaPagarDto,
  ): Promise<ContaPagarResposta> {
    return this.financeiroService.atualizarContaPagar(id, dto);
  }

  @Audita('contas_pagar')
  @CompetenciaFrom('body.dataPagamento')
  @Post('contas-pagar/:id/pagar')
  async pagarContaPagar(
    @Param('id') id: string,
    @Body() dto: PagarContaPagarDto,
    @Req() req: RequestWithUser,
  ): Promise<ContaPagarResposta> {
    return this.financeiroService.pagarContaPagar(id, dto, req.user.id);
  }

  @Get('contas-receber')
  async listarContasReceber(@Query() query: ListarContasReceberDto): Promise<ContaReceberListaResposta> {
    return this.financeiroService.listarContasReceber(query);
  }

  @Get('caixa')
  async listarMovimentacoesCaixa(
    @Query() query: ListarMovimentacoesCaixaDto,
  ): Promise<MovimentacaoCaixaListaResposta> {
    return this.financeiroService.listarMovimentacoesCaixa(query);
  }

  @Get('caixa/saldo')
  async saldoCaixa(): Promise<SaldoCaixaResposta> {
    return this.financeiroService.saldoCaixa();
  }

  @Audita('movimentacao_caixa')
  @Post('caixa')
  async criarMovimentacaoCaixa(
    @Body() dto: CriarMovimentacaoCaixaDto,
    @Req() req: RequestWithUser,
  ): Promise<MovimentacaoCaixaResposta> {
    return this.financeiroService.criarMovimentacaoCaixa(dto, req.user.id);
  }
}
