import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { CategoriaResposta, TaxaGatewayResposta } from 'contracts';
import { Audita } from '../../common/decorators/audita.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AtualizarCategoriaDto } from './dto/atualizar-categoria.dto';
import { CriarCategoriaDto } from './dto/criar-categoria.dto';
import { CriarTaxaGatewayDto } from './dto/criar-taxa-gateway.dto';
import { ConfiguracoesService } from './configuracoes.service';

/** Categorias e taxas de gateway (Card J1). Leitura liberada para qualquer
 * perfil autenticado (alimenta selects de outras telas); mutação é
 * admin-only via @Roles no próprio método, não na classe. */
@Controller('configuracoes')
export class ConfiguracoesController {
  constructor(private readonly configuracoesService: ConfiguracoesService) {}

  @Get('categorias')
  async listarCategorias(): Promise<CategoriaResposta[]> {
    return this.configuracoesService.listarCategorias();
  }

  @Roles('admin')
  @Audita('categoria')
  @Post('categorias')
  async criarCategoria(@Body() dto: CriarCategoriaDto): Promise<CategoriaResposta> {
    return this.configuracoesService.criarCategoria(dto);
  }

  @Roles('admin')
  @Audita('categoria')
  @Patch('categorias/:id')
  async atualizarCategoria(
    @Param('id') id: string,
    @Body() dto: AtualizarCategoriaDto,
  ): Promise<CategoriaResposta> {
    return this.configuracoesService.atualizarCategoria(id, dto);
  }

  @Get('taxas-gateway')
  async listarTaxasGateway(): Promise<TaxaGatewayResposta[]> {
    return this.configuracoesService.listarTaxasGateway();
  }

  @Roles('admin')
  @Audita('taxa_gateway')
  @Post('taxas-gateway')
  async criarTaxaGateway(@Body() dto: CriarTaxaGatewayDto): Promise<TaxaGatewayResposta> {
    return this.configuracoesService.criarTaxaGateway(dto);
  }
}
