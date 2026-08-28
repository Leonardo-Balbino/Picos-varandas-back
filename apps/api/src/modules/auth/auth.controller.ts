import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { MeResponse, TokenPar } from 'contracts';
import { Public } from '../../common/decorators/public.decorator';
import type { RequestWithUser } from '../../common/types/request-with-user';
import { AuthService } from './auth.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';
import { TrocarSenhaDto } from './dto/trocar-senha.dto';

// 5 tentativas por minuto por IP (Card B1). Aplicado só nas rotas de
// credencial (login/google) — refresh e me não precisam desta restrição
// específica.
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // @Public() — RolesGuard global (Card B2) exige Bearer por padrão em toda
  // rota; login/google/refresh são exatamente as rotas que emitem esse
  // Bearer, então precisam ficar de fora da exigência.
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<TokenPar> {
    return this.authService.login(dto.email, dto.senha);
  }

  @Public()
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('google')
  async google(@Body() dto: GoogleAuthDto): Promise<TokenPar> {
    return this.authService.autenticarComGoogle(dto.idToken);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto): Promise<TokenPar> {
    return this.authService.refresh(dto.refreshToken);
  }

  // Sem @Public() e sem @UseGuards explícito: o RolesGuard global já exige
  // Bearer válido por padrão (Card B2) — antes disso, cada rota autenticada
  // precisava declarar @UseGuards(JwtAuthGuard) manualmente.
  @Get('me')
  async me(@Req() req: RequestWithUser): Promise<MeResponse> {
    return this.authService.me(req.user.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('trocar-senha')
  async trocarSenha(@Req() req: RequestWithUser, @Body() dto: TrocarSenhaDto): Promise<TokenPar> {
    return this.authService.trocarSenha(req.user.id, dto.senhaAtual, dto.novaSenha);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: RequestWithUser, @Body() dto: LogoutDto): Promise<void> {
    await this.authService.logout(req.user.id, dto.refreshToken);
  }
}
