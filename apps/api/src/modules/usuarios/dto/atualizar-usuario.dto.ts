import { createZodDto } from 'nestjs-zod';
import { atualizarUsuarioSchema } from 'contracts';

export class AtualizarUsuarioDto extends createZodDto(atualizarUsuarioSchema) {}
