import { createZodDto } from 'nestjs-zod';
import { criarContaPagarSchema } from 'contracts';

export class CriarContaPagarDto extends createZodDto(criarContaPagarSchema) {}
