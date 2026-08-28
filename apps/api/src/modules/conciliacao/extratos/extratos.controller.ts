import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import type { ProcessarExtratoResponse } from 'contracts';
import { Audita } from '../../../common/decorators/audita.decorator';
import { ExtratosService } from './extratos.service';
import { ProcessarExtratoDto } from './dto/processar-extrato.dto';

@Controller('conciliacao/extratos')
export class ExtratosController {
  constructor(private readonly extratosService: ExtratosService) {}

  @Audita('extrato_importacao')
  @HttpCode(HttpStatus.OK)
  @Post('processar')
  async processar(@Body() dto: ProcessarExtratoDto): Promise<ProcessarExtratoResponse> {
    return this.extratosService.processar(dto);
  }
}
