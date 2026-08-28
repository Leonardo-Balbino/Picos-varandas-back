import { createZodDto } from 'nestjs-zod';
import { listaMovimentacoesCaixaQuerySchema } from 'contracts';

export class ListarMovimentacoesCaixaDto extends createZodDto(listaMovimentacoesCaixaQuerySchema) {}
