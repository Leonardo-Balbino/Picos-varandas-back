import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { UsuarioListaResposta, UsuarioResposta } from 'contracts';
import { Audita } from '../../common/decorators/audita.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestWithUser } from '../../common/types/request-with-user';
import { AtualizarUsuarioDto } from './dto/atualizar-usuario.dto';
import { CriarUsuarioDto } from './dto/criar-usuario.dto';
import { ListarUsuariosDto } from './dto/listar-usuarios.dto';
import { UsuariosService } from './usuarios.service';

/** CRUD de usuários (Card J1) — admin-only em toda a rota: gerenciar
 * acesso de terceiros não é ação de operador. */
@Roles('admin')
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get()
  async listar(@Query() query: ListarUsuariosDto): Promise<UsuarioListaResposta> {
    return this.usuariosService.listar(query);
  }

  @Audita('usuario')
  @Post()
  async criar(@Body() dto: CriarUsuarioDto): Promise<UsuarioResposta> {
    return this.usuariosService.criar(dto);
  }

  @Audita('usuario')
  @Patch(':id')
  async atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarUsuarioDto,
    @Req() req: RequestWithUser,
  ): Promise<UsuarioResposta> {
    return this.usuariosService.atualizar(id, dto, req.user.id);
  }
}
