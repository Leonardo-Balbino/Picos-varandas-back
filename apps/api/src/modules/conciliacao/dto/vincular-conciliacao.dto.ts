import { createZodDto } from 'nestjs-zod';
import { vincularConciliacaoSchema } from 'contracts';

export class VincularConciliacaoDto extends createZodDto(vincularConciliacaoSchema) {}
