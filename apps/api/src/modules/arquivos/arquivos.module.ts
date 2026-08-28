import { Module } from '@nestjs/common';
import { ArquivosController } from './arquivos.controller';
import { ArquivosService } from './arquivos.service';

/** Storage de arquivos (Card A4) — upload/download. StorageService vem do
 * StorageModule global, não precisa ser importado aqui. */
@Module({
  controllers: [ArquivosController],
  providers: [ArquivosService],
  exports: [ArquivosService],
})
export class ArquivosModule {}
