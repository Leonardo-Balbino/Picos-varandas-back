import { createZodDto } from 'nestjs-zod';
import { listaContasReceberQuerySchema } from 'contracts';

export class ListarContasReceberDto extends createZodDto(listaContasReceberQuerySchema) {}
