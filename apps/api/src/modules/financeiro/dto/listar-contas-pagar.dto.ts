import { createZodDto } from 'nestjs-zod';
import { listaContasPagarQuerySchema } from 'contracts';

export class ListarContasPagarDto extends createZodDto(listaContasPagarQuerySchema) {}
