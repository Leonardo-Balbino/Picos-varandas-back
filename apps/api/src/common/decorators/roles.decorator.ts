import { SetMetadata } from '@nestjs/common';
import type { PerfilUsuario } from 'contracts';

/**
 * RBAC de dois níveis (seção 3.9, Card B2): qualquer rota autenticada (sem
 * @Public) já exige um usuário válido; @Roles('admin') adiciona a exigência
 * de perfil. Ausência de @Roles em rota não-pública = qualquer perfil
 * autenticado passa (admin ou operador).
 */
export const ROLES_KEY = 'roles';
export const Roles = (...perfis: PerfilUsuario[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, perfis);
