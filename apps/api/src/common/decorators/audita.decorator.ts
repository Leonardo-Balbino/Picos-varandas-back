import { SetMetadata } from '@nestjs/common';

/**
 * Habilita o AuditoriaInterceptor global (Card B2) numa rota — opt-in, não
 * automático em toda mutação: rotas do agente (I1/I2/I4) não têm usuário
 * autenticado (Auditoria.usuarioId é NOT NULL) e não podem passar por aqui.
 *
 * IMPORTANTE — limite deste mecanismo (ver AuditoriaService para o porquê):
 * o interceptor grava a auditoria DEPOIS que o handler já respondeu, ou
 * seja, depois que qualquer transação Prisma do handler já deu commit. Para
 * mutações que passam por `prisma.$transaction(...)` (conciliação D3, baixa
 * de conta E2, caixa G1, fechamento H2), a auditoria deve ser gravada
 * DENTRO dessa mesma transação via `AuditoriaService.registrar(tx, ...)` —
 * só assim uma falha ao gravar auditoria de fato reverte a mutação. @Audita
 * aqui é para mutações single-statement, onde essa distinção não importa.
 *
 * `entidade` vira o campo `auditoria.entidade` (ex.: 'conciliacao',
 * 'contas_pagar', 'usuario'). `acao` é inferida do método HTTP pelo próprio
 * interceptor (POST→criar, PUT/PATCH→atualizar, DELETE→excluir).
 */
export const AUDITA_KEY = 'audita';
export const Audita = (entidade: string): MethodDecorator => SetMetadata(AUDITA_KEY, entidade);
