import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import type {
  ContaBancariaResposta,
  ExtratoListaResposta,
  MatchAutoResponse,
  VendaPdvListaResposta,
  VincularConciliacaoResponse,
} from 'contracts';
import { Audita } from '../../common/decorators/audita.decorator';
import type { RequestWithUser } from '../../common/types/request-with-user';
import { ConciliacaoService } from './conciliacao.service';
import { ListarConciliacaoDto } from './dto/listar-conciliacao.dto';
import { VincularConciliacaoDto } from './dto/vincular-conciliacao.dto';

/** Leitura (D2), vínculo manual (D3) e match automático (D4). Import/parse
 * de arquivo (D1) continua em POST /conciliacao/extratos/processar
 * (extratos/extratos.controller.ts, mesmo módulo). */
@Controller('conciliacao')
export class ConciliacaoController {
  constructor(private readonly conciliacaoService: ConciliacaoService) {}

  @Get('extrato')
  async listarExtrato(@Query() query: ListarConciliacaoDto): Promise<ExtratoListaResposta> {
    return this.conciliacaoService.listarExtrato(query);
  }

  // Path fixo antes do :id-like — não há conflito de rota aqui (Nest resolve por segmento
  // literal), mas a ordem segue a convenção do resto do projeto de path mais específico primeiro.
  @Get('extrato/contas')
  async listarContasBancarias(): Promise<ContaBancariaResposta[]> {
    return this.conciliacaoService.listarContasBancarias();
  }

  @Get('vendas-pdv')
  async listarVendasPdv(@Query() query: ListarConciliacaoDto): Promise<VendaPdvListaResposta> {
    return this.conciliacaoService.listarVendasPdv(query);
  }

  @Audita('conciliacao')
  @HttpCode(HttpStatus.OK)
  @Post('vincular')
  async vincular(
    @Body() dto: VincularConciliacaoDto,
    @Req() req: RequestWithUser,
  ): Promise<VincularConciliacaoResponse> {
    return this.conciliacaoService.vincular(dto, req.user.id);
  }

  @Audita('conciliacao_match_auto')
  @HttpCode(HttpStatus.OK)
  @Post('match-auto')
  async matchAutomatico(@Req() req: RequestWithUser): Promise<MatchAutoResponse> {
    return this.conciliacaoService.matchAutomatico(req.user.id);
  }
}
