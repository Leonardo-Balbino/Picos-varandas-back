import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDITA_KEY } from '../decorators/audita.decorator';
import type { RequestWithAudit } from '../types/request-with-audit';
import { AuditoriaService } from '../../modules/auditoria/auditoria.service';

const ACAO_POR_METODO: Record<string, string> = {
  POST: 'criar',
  PUT: 'atualizar',
  PATCH: 'atualizar',
  DELETE: 'excluir',
};

/**
 * Interceptor global opt-in (Card B2) — só age em rotas marcadas com
 * @Audita('entidade'). Cobre mutações single-statement (um único
 * prisma.<model>.create/update/delete, sem transação própria). Para
 * mutações multi-tabela, o service deve gravar a auditoria explicitamente
 * dentro do seu próprio `$transaction` via AuditoriaService.registrar(input,
 * tx) — ver o comentário em @Audita() e em AuditoriaService para o porquê
 * (este interceptor roda DEPOIS do handler responder, ou seja, depois de
 * qualquer commit; ele não consegue reverter a mutação de negócio se a
 * própria gravação da auditoria falhar, só torna a falha visível).
 *
 * `entidadeId` é resolvido, nesta ordem: id no corpo da resposta (cobre
 * criação, que devolve a entidade criada) → :id da rota (cobre update/
 * delete, que recebem o id no path). `payloadAntes` vem de
 * `request.auditoriaAntes` quando o service o preencheu (ver
 * RequestWithAudit); fica ausente em criação, onde não existe "antes".
 */
@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditoriaInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditoriaService: AuditoriaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const entidade = this.reflector.getAllAndOverride<string | undefined>(AUDITA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!entidade) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithAudit>();
    const acao = ACAO_POR_METODO[request.method];

    // Sem `acao` mapeada (GET, por exemplo) ou sem usuário autenticado
    // (rota pública/agente que por engano ganhou @Audita) — não é o
    // cenário para o qual este interceptor existe; segue sem auditar em vez
    // de lançar, para não derrubar uma leitura por um decorator mal posto.
    if (!acao || !request.user) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: (respostaDoHandler) => {
          const entidadeId = this.resolverEntidadeId(respostaDoHandler, request);
          this.auditoriaService
            .registrar({
              usuarioId: request.user.id,
              acao,
              entidade,
              entidadeId,
              payloadAntes: request.auditoriaAntes,
              payloadDepois: respostaDoHandler,
              ip: request.ip ?? null,
            })
            .catch((erro: unknown) => {
              // "Não pode falhar silenciosamente" (Card B2): a mutação de
              // negócio já foi commitada e a resposta HTTP já foi decidida
              // como sucesso — não há mais como reverter isso daqui. O
              // melhor que este interceptor consegue fazer é gritar alto no
              // log com o traceId, para que apareça imediatamente na
              // checagem de "toda mutação gera exatamente uma linha em
              // auditoria" (critério de pronto do Card B2) em vez de sumir.
              this.logger.error(
                `[${request.traceId}] Falha ao gravar auditoria de '${entidade}' (${acao}, id=${entidadeId}) — mutação já commitada, trilha incompleta.`,
                erro instanceof Error ? erro.stack : String(erro),
              );
            });
        },
      }),
    );
  }

  private resolverEntidadeId(respostaDoHandler: unknown, request: RequestWithAudit): string {
    if (respostaDoHandler && typeof respostaDoHandler === 'object') {
      // 'id' cobre criação de entidade única (ex.: usuário, arquivo);
      // 'arquivoId' cobre endpoints de processamento em lote que operam
      // sobre um arquivo já existente e não criam uma entidade nova com
      // 'id' próprio (ex.: Card D1 — processar extrato).
      const objeto = respostaDoHandler as { id?: unknown; arquivoId?: unknown };
      if (typeof objeto.id === 'string') return objeto.id;
      if (typeof objeto.arquivoId === 'string') return objeto.arquivoId;
    }
    const idDaRota = request.params?.id;
    return typeof idDaRota === 'string' ? idDaRota : 'desconhecido';
  }
}
