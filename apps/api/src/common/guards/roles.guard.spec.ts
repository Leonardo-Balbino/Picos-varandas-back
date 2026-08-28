import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import type { AuthService } from '../../modules/auth/auth.service';

function criarContexto(headers: Record<string, string> = {}): {
  context: ExecutionContext;
  request: { headers: Record<string, string>; user?: unknown };
} {
  const request: { headers: Record<string, string>; user?: unknown } = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('RolesGuard (Card B2)', () => {
  it('libera sem checar nada quando @Public() está presente', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) } as unknown as Reflector;
    const authService = { validarAccessToken: jest.fn() } as unknown as AuthService;
    const guard = new RolesGuard(reflector, authService);

    const { context } = criarContexto();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(authService.validarAccessToken).not.toHaveBeenCalled();
  });

  it('rejeita com 401 UNAUTHORIZED quando não há header Authorization', async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector;
    const authService = { validarAccessToken: jest.fn() } as unknown as AuthService;
    const guard = new RolesGuard(reflector, authService);

    const { context } = criarContexto();
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('popula request.user a partir do payload validado quando o token é aceito', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(undefined),
    } as unknown as Reflector;
    const authService = {
      validarAccessToken: jest.fn().mockResolvedValue({ sub: 'u1', perfil: 'operador', tokenVersion: 0 }),
    } as unknown as AuthService;
    const guard = new RolesGuard(reflector, authService);

    const { context, request } = criarContexto({ authorization: 'Bearer abc123' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'u1', perfil: 'operador' });
  });

  it('rejeita com 403 FORBIDDEN quando @Roles exige um perfil que o usuário não tem', async () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValueOnce(false) // IS_PUBLIC_KEY
        .mockReturnValueOnce(['admin']), // ROLES_KEY
    } as unknown as Reflector;
    const authService = {
      validarAccessToken: jest.fn().mockResolvedValue({ sub: 'u1', perfil: 'operador', tokenVersion: 0 }),
    } as unknown as AuthService;
    const guard = new RolesGuard(reflector, authService);

    const { context } = criarContexto({ authorization: 'Bearer abc123' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('libera quando @Roles inclui o perfil do usuário autenticado', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(['admin', 'operador']),
    } as unknown as Reflector;
    const authService = {
      validarAccessToken: jest.fn().mockResolvedValue({ sub: 'u1', perfil: 'operador', tokenVersion: 0 }),
    } as unknown as AuthService;
    const guard = new RolesGuard(reflector, authService);

    const { context } = criarContexto({ authorization: 'Bearer abc123' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
