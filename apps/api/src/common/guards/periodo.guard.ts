import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { COMPETENCIA_FROM_KEY } from '../decorators/competencia-from.decorator';
import { AppException } from '../exceptions/app.exception';
import { FechamentoService } from '../../modules/fechamento/fechamento.service';

/**
 * Guard transversal de bloqueio de período (Card H2) — registrado
 * globalmente (SecurityModule), mas opt-in via @CompetenciaFrom: rotas sem
 * o decorator (leitura, ou mutação sem noção de competência — CRUD de
 * usuários, taxas de gateway) simplesmente não são checadas. A trava vale
 * igualmente para admin e operador (seção do Card H2: "a trava não é sobre
 * perfil, é sobre integridade") — por isso este guard não olha para
 * `request.user.perfil` em nenhum momento.
 */
@Injectable()
export class PeriodoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly fechamentoService: FechamentoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const caminho = this.reflector.getAllAndOverride<string | undefined>(COMPETENCIA_FROM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!caminho) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const valorBruto = this.extrair(request, caminho);

    // Campo ausente (ex.: opcional no DTO) não é problema deste guard —
    // validação de "campo obrigatório" é responsabilidade do ZodValidationPipe
    // sobre o DTO da rota, não do guard de período.
    if (typeof valorBruto !== 'string' || valorBruto.length < 7) {
      return true;
    }

    const competencia = valorBruto.slice(0, 7);
    const fechado = await this.fechamentoService.isCompetenciaFechada(competencia);
    if (fechado) {
      // 422, não 403 (Anexo B do documento: PERIOD_LOCKED é regra de
      // negócio, não falta de permissão — corrigido em relação ao
      // planejamento anterior, que usava 403 e um header de override).
      throw new AppException({
        status: 422,
        code: 'PERIOD_LOCKED',
        message: 'Este mês está trancado para auditoria. Contate o administrador.',
        fields: { competencia },
      });
    }

    return true;
  }

  private extrair(request: Request, caminho: string): unknown {
    const partes = caminho.split('.');
    let atual: unknown = request;
    for (const parte of partes) {
      if (atual === null || typeof atual !== 'object') {
        return undefined;
      }
      atual = (atual as Record<string, unknown>)[parte];
    }
    return atual;
  }
}
