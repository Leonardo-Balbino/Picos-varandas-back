import { createZodDto } from 'nestjs-zod';
import { ingerirVendasPdvSchema } from 'contracts';

export class IngerirVendasDto extends createZodDto(ingerirVendasPdvSchema) {}
