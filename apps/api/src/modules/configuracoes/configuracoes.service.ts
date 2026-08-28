import { Injectable } from '@nestjs/common';
import type {
  AtualizarCategoriaInput,
  CategoriaResposta,
  CriarCategoriaInput,
  CriarTaxaGatewayInput,
  TaxaGatewayResposta,
} from 'contracts';
import { AppException } from '../../common/exceptions/app.exception';
import { toMoney } from '../../common/money';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { Categoria, TaxaGateway } from '../../generated/prisma/client';

/** Categorias financeiras e taxas de gateway (Card J1) — telas de
 * configuração administrativas, sem CRUD completo de taxa (nunca há
 * UPDATE/DELETE de uma vigência já criada, só novas vigências — ver
 * comentário do model TaxaGateway em schema.prisma). */
@Injectable()
export class ConfiguracoesService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------
  // Categorias
  // -------------------------------------------------------------------

  async listarCategorias(): Promise<CategoriaResposta[]> {
    const registros = await this.prisma.categoria.findMany({ orderBy: { nome: 'asc' } });
    return registros.map((registro) => this.categoriaParaResposta(registro));
  }

  async criarCategoria(input: CriarCategoriaInput): Promise<CategoriaResposta> {
    const existente = await this.prisma.categoria.findUnique({ where: { nome: input.nome } });
    if (existente) {
      throw new AppException({
        status: 409,
        code: 'CONFLICT',
        message: 'Já existe uma categoria com este nome.',
        fields: { nome: 'Nome já cadastrado.' },
      });
    }
    const criada = await this.prisma.categoria.create({ data: { nome: input.nome } });
    return this.categoriaParaResposta(criada);
  }

  async atualizarCategoria(id: string, input: AtualizarCategoriaInput): Promise<CategoriaResposta> {
    const existente = await this.prisma.categoria.findUnique({ where: { id } });
    if (!existente) {
      throw new AppException({ status: 404, code: 'NOT_FOUND', message: 'Categoria não encontrada.' });
    }
    const atualizada = await this.prisma.categoria.update({
      where: { id },
      data: { nome: input.nome, ativa: input.ativa },
    });
    return this.categoriaParaResposta(atualizada);
  }

  // -------------------------------------------------------------------
  // Taxas de gateway
  // -------------------------------------------------------------------

  async listarTaxasGateway(): Promise<TaxaGatewayResposta[]> {
    const registros = await this.prisma.taxaGateway.findMany({
      orderBy: [{ meioPagamento: 'asc' }, { vigenciaInicio: 'desc' }],
    });
    return registros.map((registro) => this.taxaParaResposta(registro));
  }

  /** Cria uma nova vigência. Se já existir uma vigência aberta (`vigenciaFim`
   * nula) para o mesmo meio/bandeira, fecha-a no dia anterior ao início da
   * nova — nunca sobrescreve uma linha existente (comentário do model). */
  async criarTaxaGateway(input: CriarTaxaGatewayInput): Promise<TaxaGatewayResposta> {
    const vigenciaInicio = new Date(input.vigenciaInicio);
    const bandeira = input.bandeira ?? null;

    const criada = await this.prisma.$transaction(async (tx) => {
      const vigenteAtual = await tx.taxaGateway.findFirst({
        where: { meioPagamento: input.meioPagamento, bandeira, vigenciaFim: null },
      });
      if (vigenteAtual) {
        const vigenciaFim = new Date(vigenciaInicio);
        vigenciaFim.setUTCDate(vigenciaFim.getUTCDate() - 1);
        await tx.taxaGateway.update({ where: { id: vigenteAtual.id }, data: { vigenciaFim } });
      }

      return tx.taxaGateway.create({
        data: {
          meioPagamento: input.meioPagamento,
          bandeira,
          percentual: input.percentual,
          diasLiquidacao: input.diasLiquidacao,
          antecipacaoAutomatica: input.antecipacaoAutomatica ?? false,
          vigenciaInicio,
        },
      });
    });

    return this.taxaParaResposta(criada);
  }

  private categoriaParaResposta(categoria: Categoria): CategoriaResposta {
    return { id: categoria.id, nome: categoria.nome, ativa: categoria.ativa };
  }

  private taxaParaResposta(taxa: TaxaGateway): TaxaGatewayResposta {
    return {
      id: taxa.id,
      meioPagamento: taxa.meioPagamento,
      bandeira: taxa.bandeira,
      percentual: toMoney(taxa.percentual) as number,
      diasLiquidacao: taxa.diasLiquidacao,
      antecipacaoAutomatica: taxa.antecipacaoAutomatica,
      vigenciaInicio: taxa.vigenciaInicio.toISOString().slice(0, 10),
      vigenciaFim: taxa.vigenciaFim ? taxa.vigenciaFim.toISOString().slice(0, 10) : null,
    };
  }
}
