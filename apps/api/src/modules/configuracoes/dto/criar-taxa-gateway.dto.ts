import { createZodDto } from 'nestjs-zod';
import { criarTaxaGatewaySchema } from 'contracts';

export class CriarTaxaGatewayDto extends createZodDto(criarTaxaGatewaySchema) {}
