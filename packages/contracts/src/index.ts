import { z } from 'zod';

/**
 * Contratos compartilhados entre apps/api e apps/web.
 *
 * Este pacote nasce (Card A1) apenas com as formas transversais definidas na
 * seção 3 do documento de especificação — paginação (3.9) e envelope de erro
 * (3.8) — porque são usadas por praticamente todo endpoint. Os schemas de
 * cada domínio (vendas, conciliação, contas a pagar, taxas de gateway...)
 * entram junto com os cards que os implementam (D1–D4, E1/E2, F1, G1,
 * H1/H2, I1/I2, J1), para não modelar contrato antes de a rota existir.
 *
 * Validação — seção 3.10: fonte única em Zod. O backend valida com estes
 * schemas via nestjs-zod (createZodDto); o frontend importa os tipos
 * inferidos (z.infer). class-validator e class-transformer não entram no
 * projeto.
 */

// ---------------------------------------------------------------------------
// Paginação — seção 3.9
// ---------------------------------------------------------------------------

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    meta: paginationMetaSchema,
  });
}

// ---------------------------------------------------------------------------
// Envelope de erro padrão — seção 3.8
// ---------------------------------------------------------------------------

export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'PERIOD_LOCKED',
  'CONFLICT',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'UNBALANCED',
  'INSUFFICIENT_FUNDS',
  // Não fazem parte da lista fechada da seção 3.8 do documento — adicionados
  // nesta sessão porque o filtro global precisa de um código para casos que
  // a seção 3.8 não previu.
  'RATE_LIMITED', // 429 do @nestjs/throttler (Card B1) — rotas de login.
  'INTERNAL_ERROR', // fallback para qualquer exceção não mapeada.
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
    traceId: z.string(),
  }),
});
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Convenção de schema de entrada — seção 3.10
// ---------------------------------------------------------------------------

/**
 * Todo schema de request passa por aqui em vez de `z.object(shape)` direto.
 * `.strict()` é o equivalente Zod de `whitelist: true` + `forbidNonWhitelisted:
 * true` do class-validator: chave desconhecida no payload vira erro de
 * validação em vez de ser silenciosamente descartada. Usar este helper (em
 * vez de lembrar de chamar `.strict()` em cada schema individualmente)
 * torna esse comportamento o padrão, não uma escolha por endpoint.
 */
export function requestSchema<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

// ---------------------------------------------------------------------------
// Autenticação — Card B1
// ---------------------------------------------------------------------------

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

/** Forma pública do usuário — nunca inclui senhaHash, tokenVersion ou googleId. */
export const usuarioPublicoSchema = z.object({
  id: z.string(),
  nome: z.string(),
  email: z.email(),
  perfil: perfilUsuarioSchema,
  avatarUrl: z.string().nullable(),
  ativo: z.boolean(),
});
export type UsuarioPublico = z.infer<typeof usuarioPublicoSchema>;

/** Resposta de /auth/login, /auth/google e /auth/refresh (seção B1). */
export const tokenParSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
  usuario: usuarioPublicoSchema,
});
export type TokenPar = z.infer<typeof tokenParSchema>;

/** Resposta de GET /auth/me — perfil e permissões do usuário autenticado.
 * Com RBAC de dois níveis (seção 3.9), o próprio `perfil` já é a
 * declaração completa de permissões; não há lista granular no documento. */
export const meResponseSchema = usuarioPublicoSchema;
export type MeResponse = z.infer<typeof meResponseSchema>;
