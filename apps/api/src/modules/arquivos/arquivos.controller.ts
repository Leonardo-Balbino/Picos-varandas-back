import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import type { ArquivoResposta } from 'contracts';
import { Audita } from '../../common/decorators/audita.decorator';
import type { RequestWithUser } from '../../common/types/request-with-user';
import { ArquivosService } from './arquivos.service';
import { UploadArquivoDto } from './dto/upload-arquivo.dto';

/**
 * Storage de arquivos (Card A4). Upload autenticado (qualquer perfil — não é
 * ação administrativa), sem `@UseGuards` extra: o RolesGuard global (Card
 * B2) já exige sessão válida por padrão, aqui não há `@Public()`.
 */
@Controller('arquivos')
export class ArquivosController {
  constructor(private readonly arquivosService: ArquivosService) {}

  @Audita('arquivo')
  @Post('upload')
  @UseInterceptors(FileInterceptor('arquivo'))
  async upload(
    @UploadedFile() arquivo: Express.Multer.File | undefined,
    @Body() dto: UploadArquivoDto,
    @Req() req: RequestWithUser,
  ): Promise<ArquivoResposta> {
    return this.arquivosService.upload(arquivo, dto.contexto, req.user.id);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { buffer, nomeOriginal, mimeType } = await this.arquivosService.baixar(id);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(nomeOriginal)}"`,
      'Content-Length': String(buffer.length),
    });
    res.send(buffer);
  }
}
