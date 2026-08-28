import { createZodDto } from 'nestjs-zod';
import { listaConciliacaoQuerySchema } from 'contracts';

export class ListarConciliacaoDto extends createZodDto(listaConciliacaoQuerySchema) {}
