import { Module } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';

/**
 * Trilha de auditoria (Card B2). Módulo próprio (não dentro de common/)
 * porque `auditoria` também é uma entidade de domínio com sua própria
 * tabela (Card A2) — não é só infraestrutura transversal.
 */
@Module({
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
