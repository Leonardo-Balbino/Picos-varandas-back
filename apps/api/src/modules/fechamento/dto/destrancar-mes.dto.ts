import { createZodDto } from 'nestjs-zod';
import { destrancarMesSchema } from 'contracts';

export class DestrancarMesDto extends createZodDto(destrancarMesSchema) {}
