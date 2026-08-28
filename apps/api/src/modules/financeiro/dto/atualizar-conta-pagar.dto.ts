import { createZodDto } from 'nestjs-zod';
import { atualizarContaPagarSchema } from 'contracts';

export class AtualizarContaPagarDto extends createZodDto(atualizarContaPagarSchema) {}
