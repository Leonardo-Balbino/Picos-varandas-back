import { createZodDto } from 'nestjs-zod';
import { criarCategoriaSchema } from 'contracts';

export class CriarCategoriaDto extends createZodDto(criarCategoriaSchema) {}
