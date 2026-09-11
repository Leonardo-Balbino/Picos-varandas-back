import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { HmacAuthGuard } from '../../../common/guards/hmac-auth.guard';
import type { RequestWithTraceId } from '../../../common/types/request-with-trace';
import {
  ConfirmarParteUploadBackupDto,
  ConcluirUploadBackupDto,
  IniciarUploadBackupDto,
  PrepararParteUploadBackupDto,
} from './backup-upload.dto';
import { BackupUploadService } from './backup-upload.service';

@Public()
@UseGuards(HmacAuthGuard)
@Controller('sync/backups')
export class BackupUploadController {
  constructor(private readonly service: BackupUploadService) {}

  @HttpCode(HttpStatus.OK)
  @Post('initiate')
  iniciar(@Req() req: RequestWithTraceId, @Body() dto: IniciarUploadBackupDto) {
    return this.service.iniciar(this.agente(req), dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':uploadId/parts')
  preparar(
    @Req() req: RequestWithTraceId,
    @Param('uploadId') uploadId: string,
    @Body() dto: PrepararParteUploadBackupDto,
  ) {
    return this.service.prepararParte(this.agente(req), uploadId, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':uploadId/parts/:partNumber/confirm')
  confirmar(
    @Req() req: RequestWithTraceId,
    @Param('uploadId') uploadId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
    @Body() dto: ConfirmarParteUploadBackupDto,
  ) {
    return this.service.confirmarParte(this.agente(req), uploadId, partNumber, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':uploadId/complete')
  concluir(
    @Req() req: RequestWithTraceId,
    @Param('uploadId') uploadId: string,
    @Body() dto: ConcluirUploadBackupDto,
  ) {
    return this.service.concluir(this.agente(req), uploadId, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':uploadId/status')
  status(@Req() req: RequestWithTraceId, @Param('uploadId') uploadId: string) {
    return this.service.status(this.agente(req), uploadId);
  }

  private agente(req: RequestWithTraceId): string {
    // O guard sempre preenche; a checagem evita aceitar um request caso o
    // controller seja reaproveitado sem o guard no futuro.
    if (!req.agentId) throw new Error('Identidade autenticada do agente ausente.');
    return req.agentId;
  }
}
