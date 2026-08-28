import { z } from 'zod';
import { perfilUsuarioSchema } from './auth';
import { paginatedSchema, paginationQuerySchema, requestSchema } from './common';

/** CRUD de usuários e níveis de acesso (Card J1). `precisaTrocarSenha` fica
 * de fora de propósito, igual em `usuarioPublicoSchema` (auth.ts) — é sinal
 * operacional da sessão de quem logou, não um dado que a lista de admin
 * deveria expor sobre terceiros. */
export const usuarioRespostaSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.email(),
  perfil: perfilUsuarioSchema,
  ativo: z.boolean(),
  avatarUrl: z.string().nullable(),
  criadoEm: z.string(),
});
export type UsuarioResposta = z.infer<typeof usuarioRespostaSchema>;

export const usuarioListaRespostaSchema = paginatedSchema(usuarioRespostaSchema);
export type UsuarioListaResposta = z.infer<typeof usuarioListaRespostaSchema>;

export const listaUsuariosQuerySchema = paginationQuerySchema;
export type ListaUsuariosQuery = z.infer<typeof listaUsuariosQuerySchema>;

export const criarUsuarioSchema = requestSchema({
  nome: z.string().min(1, 'Nome é obrigatório.'),
  email: z.email(),
  senha: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres.'),
  perfil: perfilUsuarioSchema,
});
export type CriarUsuarioInput = z.infer<typeof criarUsuarioSchema>;

/** PATCH .../:id — nunca troca e-mail nem senha por aqui (e-mail é a
 * identidade do login; senha tem fluxo próprio em POST /auth/trocar-senha,
 * autenticado como o próprio dono). `ativo: false` incrementa tokenVersion no
 * service — mesmo mecanismo de invalidação imediata de sessão do Card B1. */
export const atualizarUsuarioSchema = requestSchema({
  nome: z.string().min(1).optional(),
  perfil: perfilUsuarioSchema.optional(),
  ativo: z.boolean().optional(),
});
export type AtualizarUsuarioInput = z.infer<typeof atualizarUsuarioSchema>;
