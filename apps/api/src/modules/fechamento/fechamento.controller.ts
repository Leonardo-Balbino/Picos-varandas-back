import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { FechamentoResposta } from 'contracts';
import { Audita } from '../../common/decorators/audita.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestWithUser } from '../../common/types/request-with-user';
import { DestrancarMesDto } from './dto/destrancar-mes.dto';
import { TrancarMesDto } from './dto/trancar-mes.dto';
import { FechamentoService } from './fechamento.service';

/** Grade anual (H1) e trancar/destrancar (H2). Trancar/destrancar é
 * admin-only por método (não pela classe — a leitura da grade é liberada
 * para qualquer perfil, ela alimenta a tela de fechamento inteira). */
@Controller('fechamentos')
export class FechamentoController {
  constructor(private readonly fechamentoService: FechamentoService) {}

  @Get()
  async listar(): Promise<FechamentoResposta[]> {
    return this.fechamentoService.listarFechamentos();
  }

  @Roles('admin')
  @Audita('fechamento')
  @HttpCode(HttpStatus.OK)
  @Post(':anoMes/trancar')
  async trancar(
    @Param('anoMes') anoMes: string,
    @Body() _dto: TrancarMesDto,
    @Req() req: RequestWithUser,
  ): Promise<FechamentoResposta> {
    return this.fechamentoService.trancar(anoMes, req.user.id);
  }

  @Roles('admin')
  @Audita('fechamento')
  @HttpCode(HttpStatus.OK)
  @Post(':anoMes/destrancar')
  async destrancar(
    @Param('anoMes') anoMes: string,
    @Body() dto: DestrancarMesDto,
  ): Promise<FechamentoResposta> {
    return this.fechamentoService.destrancar(anoMes, dto);
  }
}
