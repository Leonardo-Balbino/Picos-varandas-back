import { createZodDto } from 'nestjs-zod';
import { criarUsuarioSchema } from 'contracts';

export class CriarUsuarioDto extends createZodDto(criarUsuarioSchema) {}
