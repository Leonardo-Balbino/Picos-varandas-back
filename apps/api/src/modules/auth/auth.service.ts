import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { OAuth2Client } from 'google-auth-library';
import type { MeResponse, UsuarioPublico } from 'contracts';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AccessTokenPayload } from './token-payload';

const ACCESS_TOKEN_TTL_SEGUNDOS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hash argon2id fixo, nunca correspondido por nenhuma senha real — usado
 * para gastar o mesmo tempo de CPU de uma verificação real quando o e-mail
 * não existe ou não tem senha local. Sem isso, a ausência do usuário
 * responderia mais rápido que uma senha errada, e esse timing é um jeito
 * indireto de descobrir se um e-mail está cadastrado — exatamente o que a
 * "resposta genérica" do Card B1 existe para evitar. */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ZMdSsFWEhdHgU+AaB8BiGQ$dcGSiynTir4Vb3LIuEyOG4s/2XsCu6m5K4jauzmiAhk';

export interface TokenPar {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  usuario: UsuarioPublico;
  precisaTrocarSenha: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {
    // Instanciado mesmo sem GOOGLE_CLIENT_ID configurado — só falha quando
    // /auth/google é de fato chamado, não no boot (mesma regra de "nenhuma
    // dependência pesada ou I/O no bootstrap", seção 3.6).
    this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  async login(email: string, senha: string): Promise<TokenPar> {
    const usuario = await this.prisma.usuario.findUnique({ where: { email } });

    // Mesma mensagem e mesmo código para e-mail inexistente e senha errada
    // (Card B1: "resposta genérica... independente de o e-mail existir").
    // A verificação contra DUMMY_HASH mantém o tempo de resposta
    // equivalente ao caminho de senha errada.
    const senhaCorreta = await argon2Verify(usuario?.senhaHash ?? DUMMY_HASH, senha).catch(
      () => false,
    );
    if (!usuario || !usuario.senhaHash || !senhaCorreta) {
      throw this.credenciaisInvalidas();
    }

    if (!usuario.ativo) {
      throw this.usuarioInativo();
    }

    return this.emitirParDeTokens(usuario, randomUUID());
  }

  async autenticarComGoogle(idToken: string): Promise<TokenPar> {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      // Falha de configuração do servidor, não do cliente — 500 é o status
      // correto aqui (não é o usuário que errou algo).
      throw new AppException({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Login por Google não está configurado.',
      });
    }

    let email: string | undefined;
    let googleId: string | undefined;
    try {
      const ticket = await this.googleClient.verifyIdToken({ idToken, audience: clientId });
      const payload = ticket.getPayload();
      email = payload?.email;
      googleId = payload?.sub;
    } catch {
      throw this.credenciaisInvalidas();
    }

    if (!email || !googleId) {
      throw this.credenciaisInvalidas();
    }

    // Não há auto-cadastro (Card B1): o e-mail precisa já existir e estar
    // ativo. Diferente do login por senha, aqui não há "senha errada" para
    // disfarçar — a mensagem é honesta sobre a causa (403), porque só quem
    // já provou dono do e-mail no Google chega até aqui.
    const usuario = await this.prisma.usuario.findUnique({ where: { email } });
    if (!usuario || !usuario.ativo) {
      throw this.usuarioInativo(
        'Este e-mail não possui acesso ao sistema. Contate o administrador.',
      );
    }

    // Vincula por e-mail (Card B1) — primeira vez logando com Google, o
    // usuário pode já existir só com senha local.
    if (usuario.googleId !== googleId) {
      await this.prisma.usuario.update({ where: { id: usuario.id }, data: { googleId } });
    }

    return this.emitirParDeTokens(usuario, randomUUID());
  }

  async refresh(refreshTokenBruto: string): Promise<TokenPar> {
    const tokenHash = this.hashToken(refreshTokenBruto);
    const registro = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!registro) {
      throw this.credenciaisInvalidas('Refresh token inválido.');
    }

    if (registro.revogadoEm) {
      // Reuso de token já rotacionado: sinal de que o token vazou (alguém
      // capturou uma rotação antiga e está tentando usá-la). Revoga a
      // família inteira — inclusive o token que estava legitimamente em
      // uso — forçando novo login. Isso é uma decisão deliberada de
      // segurança sobre conveniência (Card B1).
      await this.revogarFamilia(registro.familiaId);
      this.logger.warn(
        `Reuso de refresh token detectado (família ${registro.familiaId}) — família revogada.`,
      );
      throw this.credenciaisInvalidas('Sessão revogada por reuso de token.');
    }

    if (registro.expiraEm < new Date()) {
      throw this.credenciaisInvalidas('Refresh token expirado.');
    }

    const usuario = await this.prisma.usuario.findUnique({ where: { id: registro.usuarioId } });
    if (!usuario || !usuario.ativo) {
      throw this.credenciaisInvalidas();
    }

    // Rotação: marca o token atual como revogado e emite um novo na MESMA
    // família, antes de qualquer outra coisa poder falhar no meio.
    await this.prisma.refreshToken.update({
      where: { id: registro.id },
      data: { revogadoEm: new Date() },
    });

    return this.emitirParDeTokens(usuario, registro.familiaId);
  }

  async me(usuarioId: string): Promise<MeResponse> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) {
      throw this.credenciaisInvalidas();
    }
    return { ...this.paraUsuarioPublico(usuario), precisaTrocarSenha: usuario.precisaTrocarSenha };
  }

  /** POST /auth/trocar-senha (Passo 0.4 — fecha a lacuna aberta pelo campo
   * `precisaTrocarSenha`). Exige a senha atual mesmo em troca obrigatória —
   * um access token roubado sozinho não deve bastar para assumir a conta
   * definitivamente. Reaproveita o par existente ou emite um novo
   * (preferido: incrementa tokenVersion, então requisições concorrentes com
   * o token antigo passam a exigir refresh, igual a uma inativação). */
  async trocarSenha(usuarioId: string, senhaAtual: string, novaSenha: string): Promise<TokenPar> {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) {
      throw this.credenciaisInvalidas();
    }

    const senhaAtualCorreta = await argon2Verify(usuario.senhaHash ?? DUMMY_HASH, senhaAtual).catch(
      () => false,
    );
    if (!usuario.senhaHash || !senhaAtualCorreta) {
      throw new AppException({
        status: 401,
        code: 'UNAUTHORIZED',
        message: 'Senha atual incorreta.',
      });
    }

    const novoHash = await argon2Hash(novaSenha);
    // tokenVersion incrementa: mesmo mecanismo de invalidação imediata usado
    // para `ativo: false` (Card J1) — qualquer access token emitido antes da
    // troca deixa de validar em AuthService.validarAccessToken.
    const atualizado = await this.prisma.usuario.update({
      where: { id: usuarioId },
      data: {
        senhaHash: novoHash,
        precisaTrocarSenha: false,
        tokenVersion: { increment: 1 },
      },
    });

    // Novo par de tokens na mesma família seria incorreto aqui (não veio de
    // um refresh) — abre uma família nova, igual ao login.
    return this.emitirParDeTokens(atualizado, randomUUID());
  }

  async logout(usuarioId: string, refreshTokenBruto: string): Promise<void> {
    const tokenHash = this.hashToken(refreshTokenBruto);
    const registro = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    // Token não encontrado, já revogado, ou de outro usuário: logout é
    // idempotente do ponto de vista do cliente — não há nada de sensível a
    // revelar aqui, então não lançamos erro, apenas não fazemos nada.
    if (!registro || registro.usuarioId !== usuarioId) {
      return;
    }

    await this.revogarFamilia(registro.familiaId);
  }

  /** Verificação usada pelo RolesGuard. Decodifica e valida assinatura +
   * expiração do JWT, e confere tokenVersion/ativo contra o banco — é essa
   * segunda parte que faz a invalidação por `ativo: false` ser imediata em
   * vez de esperar os 15 minutos do token. */
  async validarAccessToken(token: string): Promise<AccessTokenPayload> {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw this.credenciaisInvalidas('Token inválido ou expirado.');
    }

    const usuario = await this.prisma.usuario.findUnique({ where: { id: payload.sub } });
    if (!usuario || !usuario.ativo || usuario.tokenVersion !== payload.tokenVersion) {
      throw this.credenciaisInvalidas('Sessão inválida.');
    }

    return payload;
  }

  private async emitirParDeTokens(
    usuario: {
      id: string;
      nome: string;
      email: string;
      perfil: 'admin' | 'operador';
      avatarUrl: string | null;
      ativo: boolean;
      tokenVersion: number;
      precisaTrocarSenha: boolean;
    },
    familiaId: string,
  ): Promise<TokenPar> {
    const accessTokenPayload: AccessTokenPayload = {
      sub: usuario.id,
      perfil: usuario.perfil,
      tokenVersion: usuario.tokenVersion,
    };
    const accessToken = await this.jwtService.signAsync(accessTokenPayload, {
      expiresIn: ACCESS_TOKEN_TTL_SEGUNDOS,
    });

    const refreshTokenBruto = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        usuarioId: usuario.id,
        familiaId,
        tokenHash: this.hashToken(refreshTokenBruto),
        expiraEm: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenBruto,
      expiresIn: ACCESS_TOKEN_TTL_SEGUNDOS,
      usuario: this.paraUsuarioPublico(usuario),
      precisaTrocarSenha: usuario.precisaTrocarSenha,
    };
  }

  private async revogarFamilia(familiaId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familiaId, revogadoEm: null },
      data: { revogadoEm: new Date() },
    });
  }

  /** SHA-256 simples, não argon2: o valor já nasce aleatório de alta
   * entropia (48 bytes do gerador do servidor), não é uma senha escolhida
   * por humano — não há o que um algoritmo lento de senha protegeria aqui.
   * Hash determinístico permite localizar o token por igualdade
   * (tokenHash é @unique), o que argon2 (salt por chamada) não permite. */
  private hashToken(tokenBruto: string): string {
    return createHash('sha256').update(tokenBruto).digest('hex');
  }

  private paraUsuarioPublico(usuario: {
    id: string;
    nome: string;
    email: string;
    perfil: 'admin' | 'operador';
    avatarUrl: string | null;
    ativo: boolean;
  }): UsuarioPublico {
    return {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      avatarUrl: usuario.avatarUrl,
      ativo: usuario.ativo,
    };
  }

  private credenciaisInvalidas(message = 'E-mail ou senha inválidos.'): AppException {
    return new AppException({ status: 401, code: 'UNAUTHORIZED', message });
  }

  private usuarioInativo(message = 'Usuário inativo. Contate o administrador.'): AppException {
    return new AppException({ status: 403, code: 'FORBIDDEN', message });
  }

  /** Hash de senha para o seed e para o futuro CRUD de usuários (Card J1).
   * argon2id via @node-rs/argon2 — binário pré-compilado, funciona em
   * Alpine sem toolchain nativo (diferente do pacote `argon2`). */
  static async hashSenha(senha: string): Promise<string> {
    return argon2Hash(senha);
  }
}
