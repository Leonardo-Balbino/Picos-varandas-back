import { createZodDto } from 'nestjs-zod';
import { pagarContaPagarSchema } from 'contracts';

export class PagarContaPagarDto extends createZodDto(pagarContaPagarSchema) {}
