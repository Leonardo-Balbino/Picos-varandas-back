import { Injectable } from '@nestjs/common';
import type {
  AtualizarUsuarioInput,
  CriarUsuarioInput,
  ListaUsuariosQuery,
  UsuarioListaResposta,
  UsuarioResposta,
} from 'contracts';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { Usuario } from '../../generated/prisma/client';
import { AuthService } from '../auth/auth.service';

/**
 * CRUD de usuários e níveis de acesso (Card J1). Sem DELETE — a UI só
 * desativa (`ativo: false`), nunca apaga (histórico de auditoria/lançamentos
 * referencia `usuarioId`, não faz sentido perder o registro).
 */
@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(query: ListaUsuariosQuery): Promise<UsuarioListaResposta> {
    const { page, pageSize } = query;
    const [registros, total] = await Promise.all([
      this.prisma.usuario.findMany({
        orderBy: { nome: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.usuario.count(),
    ]);

    return {
      data: registros.map((registro) => this.paraResposta(registro)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async criar(input: CriarUsuarioInput): Promise<UsuarioResposta> {
    const existente = await this.prisma.usuario.findUnique({ where: { email: input.email } });
    if (existente) {
      throw new AppException({
        status: 409,
        code: 'CONFLICT',
        message: 'Já existe um usuário com este e-mail.',
        fields: { email: 'E-mail já cadastrado.' },
      });
    }

    const senhaHash = await AuthService.hashSenha(input.senha);
    const criado = await this.prisma.usuario.create({
      data: {
        nome: input.nome,
        email: input.email,
        senhaHash,
        perfil: input.perfil,
        ativo: true,
        // Senha definida por outra pessoa (o admin que cadastrou) — força
        // troca no primeiro login, mesmo mecanismo do seed inicial (ver
        // prisma/seed.ts).
        precisaTrocarSenha: true,
      },
    });

    return this.paraResposta(criado);
  }

  async atualizar(
    id: string,
    input: AtualizarUsuarioInput,
    solicitanteId: string,
  ): Promise<UsuarioResposta> {
    const atual = await this.buscarOuFalhar(id);

    const estaSeDesativando = input.ativo === false && id === solicitanteId;
    const estaSeRebaixando = input.perfil === 'operador' && atual.perfil === 'admin' && id === solicitanteId;
    if (estaSeDesativando || estaSeRebaixando) {
      throw new AppException({
        status: 409,
        code: 'CONFLICT',
        message: 'Você não pode desativar ou rebaixar o próprio usuário.',
      });
    }

    // Transição para inativo invalida sessões em circulação imediatamente —
    // mesmo mecanismo de `tokenVersion` usado em troca de senha (Card B1) e
    // documentado no comentário de `precisaTrocarSenha` em schema.prisma.
    const vaiDesativar = input.ativo === false && atual.ativo;

    const atualizado = await this.prisma.usuario.update({
      where: { id },
      data: {
        nome: input.nome,
        perfil: input.perfil,
        ativo: input.ativo,
        ...(vaiDesativar ? { tokenVersion: { increment: 1 } } : {}),
      },
    });

    return this.paraResposta(atualizado);
  }

  private async buscarOuFalhar(id: string): Promise<Usuario> {
    const registro = await this.prisma.usuario.findUnique({ where: { id } });
    if (!registro) {
      throw new AppException({ status: 404, code: 'NOT_FOUND', message: 'Usuário não encontrado.' });
    }
    return registro;
  }

  private paraResposta(usuario: Usuario): UsuarioResposta {
    return {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      ativo: usuario.ativo,
      avatarUrl: usuario.avatarUrl,
      criadoEm: usuario.criadoEm.toISOString(),
    };
  }
}
