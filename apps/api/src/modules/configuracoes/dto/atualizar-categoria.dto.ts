import { createZodDto } from 'nestjs-zod';
import { atualizarCategoriaSchema } from 'contracts';

export class AtualizarCategoriaDto extends createZodDto(atualizarCategoriaSchema) {}
