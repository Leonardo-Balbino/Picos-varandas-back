import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { TokenPar, UsuarioPublico } from 'contracts';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { RequestWithUser } from '../../common/types/request-with-user';
import { AuthService } from './auth.service';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshDto } from './dto/refresh.dto';

// 5 tentativas por minuto por IP (Card B1). Aplicado só nas rotas de
// credencial (login/google) — refresh e me não precisam desta restrição
// específica.
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<TokenPar> {
    return this.authService.login(dto.email, dto.senha);
  }

  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('google')
  async google(@Body() dto: GoogleAuthDto): Promise<TokenPar> {
    return this.authService.autenticarComGoogle(dto.idToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto): Promise<TokenPar> {
    return this.authService.refresh(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: RequestWithUser): Promise<UsuarioPublico> {
    return this.authService.me(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: RequestWithUser, @Body() dto: LogoutDto): Promise<void> {
    await this.authService.logout(req.user.id, dto.refreshToken);
  }
}
