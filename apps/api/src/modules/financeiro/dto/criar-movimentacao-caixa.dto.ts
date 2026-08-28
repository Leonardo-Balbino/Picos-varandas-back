import { createZodDto } from 'nestjs-zod';
import { criarMovimentacaoCaixaSchema } from 'contracts';

export class CriarMovimentacaoCaixaDto extends createZodDto(criarMovimentacaoCaixaSchema) {}
