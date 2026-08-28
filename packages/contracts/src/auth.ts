import { z } from 'zod';
import { requestSchema } from './common';

/**
 * Autenticação — Card B1/B2. Validação — seção 3.10: fonte única em Zod. O
 * backend valida com estes schemas via nestjs-zod (createZodDto); o
 * frontend importa os tipos inferidos (z.infer). class-validator e
 * class-transformer não entram no projeto.
 */

export const perfilUsuarioSchema = z.enum(['admin', 'operador']);
export type PerfilUsuario = z.infer<typeof perfilUsuarioSchema>;

export const loginSchema = requestSchema({
  email: z.email(),
  senha: z.string().min(1, 'Senha é obrigatória.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const googleAuthSchema = requestSchema({
  idToken: z.string().min(1, 'idToken é obrigatório.'),
});
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;

export const refreshSchema = requestSchema({
  refreshToken: z.string().min(1, 'refreshToken é obrigatório.'),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = requestSchema({
  refreshToken: z.string().min(1, 'refreshToken é obrigatório.'),
});
export type LogoutInput = z.infer<typeof logoutSchema>;

/** Forma pública do usuário — nunca inclui senhaHash, tokenVersion ou
 * googleId. `precisaTrocarSenha` NÃO entra aqui de propósito: é um sinal
 * operacional da sessão atual (ver tokenParSchema/meResponseSchema abaixo),
 * não um dado de perfil que outra tela (ex.: lista de usuários do Card J1)
 * deveria expor sobre terceiros. */
export const usuarioPublicoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.email(),
  perfil: perfilUsuarioSchema,
  avatarUrl: z.string().nullable(),
  ativo: z.boolean(),
});
export type UsuarioPublico = z.infer<typeof usuarioPublicoSchema>;

/** Resposta de /auth/login, /auth/google e /auth/refresh (seção B1).
 * `precisaTrocarSenha` (Passo 0.4 desta sessão): o frontend deve forçar a
 * tela de troca de senha antes de liberar o resto do sistema quando este
 * campo vier `true` — cenário do seed inicial e de reset de senha pelo
 * admin (Card J1). */
export const tokenParSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  usuario: usuarioPublicoSchema,
  precisaTrocarSenha: z.boolean(),
});
export type TokenPar = z.infer<typeof tokenParSchema>;

/** Resposta de GET /auth/me — perfil e permissões do usuário autenticado,
 * mais o mesmo sinal `precisaTrocarSenha` do login (útil para restaurar a
 * sessão numa aba nova sem refazer login). Com RBAC de dois níveis (seção
 * 3.9), o próprio `perfil` já é a declaração completa de permissões; não há
 * lista granular no documento. */
export const meResponseSchema = usuarioPublicoSchema.extend({
  precisaTrocarSenha: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** POST /auth/trocar-senha — endpoint que fecha a lacuna aberta pelo campo
 * `precisaTrocarSenha` (Passo 0.4): exige a senha atual (mesmo em troca
 * obrigatória — evita que um access token roubado sozinho baste para
 * assumir a conta) e a nova senha duas vezes para evitar erro de digitação
 * silencioso. */
export const trocarSenhaSchema = requestSchema({
  senhaAtual: z.string().min(1, 'Senha atual é obrigatória.'),
  novaSenha: z.string().min(8, 'Nova senha deve ter no mínimo 8 caracteres.'),
  confirmacaoNovaSenha: z.string().min(1, 'Confirmação da nova senha é obrigatória.'),
}).refine((data) => data.novaSenha === data.confirmacaoNovaSenha, {
  message: 'A confirmação não corresponde à nova senha.',
  path: ['confirmacaoNovaSenha'],
});
export type TrocarSenhaInput = z.infer<typeof trocarSenhaSchema>;
