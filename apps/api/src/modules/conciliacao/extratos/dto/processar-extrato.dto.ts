import { createZodDto } from 'nestjs-zod';
import { processarExtratoSchema } from 'contracts';

export class ProcessarExtratoDto extends createZodDto(processarExtratoSchema) {}
