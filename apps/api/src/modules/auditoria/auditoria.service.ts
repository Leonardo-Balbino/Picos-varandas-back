import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface RegistrarAuditoriaInput {
  usuarioId: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  payloadAntes?: unknown;
  payloadDepois?: unknown;
  ip?: string | null;
}

const CHAVES_SENSIVEIS = new Set([
  'senha',
  'senhaAtual',
  'novaSenha',
  'confirmacaoNovaSenha',
  'senhaHash',
  'accessToken',
  'refreshToken',
  'idToken',
  'tokenHash',
]);

/**
 * Nunca grava campo sensível na trilha de auditoria (Card A5: "proibido
 * logar... hashes de senha"; mesma regra vale para a tabela `auditoria`,
 * não só para logs). Redige por nome de chave, recursivamente, em vez de
 * confiar em cada chamador lembrar de omitir o campo manualmente.
 */
function sanitizar(valor: unknown): Prisma.InputJsonValue | undefined {
  if (valor === undefined || valor === null) {
    return undefined;
  }
  const limpar = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.map(limpar);
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [chave, valorCampo] of Object.entries(v)) {
        out[chave] = CHAVES_SENSIVEIS.has(chave) ? '[redigido]' : limpar(valorCampo);
      }
      return out;
    }
    return v;
  };
  // JSON.parse(JSON.stringify(...)) normaliza Decimal/Date/etc. para algo
  // serializável antes da recursão de redação — evita depender de cada
  // mapper já ter convertido tudo para JSON puro antes de chamar aqui.
  return limpar(JSON.parse(JSON.stringify(valor))) as Prisma.InputJsonValue;
}

/**
 * Grava a trilha de auditoria (Card B2). `cliente` aceita tanto o
 * PrismaService global quanto um `Prisma.TransactionClient` (o `tx` de
 * `prisma.$transaction(async (tx) => ...)`). Serviços com mutação
 * multi-tabela (conciliação D3, baixa de conta E2, caixa G1, fechamento H2)
 * DEVEM passar o `tx` da própria transação — é a única forma de uma falha
 * ao gravar auditoria de fato reverter a mutação de negócio junto, porque
 * um interceptor rodando depois da resposta HTTP não consegue desfazer um
 * COMMIT que já aconteceu. Ver AuditoriaInterceptor para o caso
 * single-statement onde essa distinção não importa.
 */
@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(
    input: RegistrarAuditoriaInput,
    cliente: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await cliente.auditoria.create({
      data: {
        usuarioId: input.usuarioId,
        acao: input.acao,
        entidade: input.entidade,
        entidadeId: input.entidadeId,
        payloadAntes: sanitizar(input.payloadAntes) ?? undefined,
        payloadDepois: sanitizar(input.payloadDepois) ?? undefined,
        ip: input.ip ?? null,
      },
    });
  }
}
