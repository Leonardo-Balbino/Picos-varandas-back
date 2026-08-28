import { createZodDto } from 'nestjs-zod';
import { trancarMesSchema } from 'contracts';

export class TrancarMesDto extends createZodDto(trancarMesSchema) {}
