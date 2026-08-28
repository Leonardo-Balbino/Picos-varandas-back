/**
 * Contratos compartilhados entre apps/api e apps/web.
 *
 * Barrel puro — cada domínio vive no seu próprio arquivo (common.ts, auth.ts,
 * e um novo arquivo por card conforme entra: conciliacao.ts, financeiro.ts,
 * fechamento.ts, sync.ts, configuracoes.ts...). Ver common.ts para o porquê
 * do split.
 */
export * from './common';
export * from './auth';
export * from './sync';
export * from './arquivos';
export * from './conciliacao';
