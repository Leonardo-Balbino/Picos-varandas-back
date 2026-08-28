import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { IngerirVendasPdvResponse } from 'contracts';
import { Public } from '../../../common/decorators/public.decorator';
import { HmacAuthGuard } from '../../../common/guards/hmac-auth.guard';
import { IngerirVendasDto } from './dto/ingerir-vendas.dto';
import { VendasSyncService } from './vendas-sync.service';

// @Public() + @UseGuards(HmacAuthGuard) sempre juntos aqui (ver o
// comentário em Public() para o porquê de precisar dos dois): o agente
// local não tem JWT, então @Public() afasta o RolesGuard global, e
// HmacAuthGuard é quem de fato autentica a requisição por assinatura.
@Public()
@UseGuards(HmacAuthGuard)
@Controller('sync')
export class VendasSyncController {
  constructor(private readonly vendasSyncService: VendasSyncService) {}

  @HttpCode(HttpStatus.OK)
  @Post('vendas-pdv')
  async ingerir(@Body() dto: IngerirVendasDto): Promise<IngerirVendasPdvResponse> {
    return this.vendasSyncService.ingerir(dto);
  }
}
