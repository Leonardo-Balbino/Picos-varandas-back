import { createZodDto } from 'nestjs-zod';
import { refreshSchema } from 'contracts';

export class RefreshDto extends createZodDto(refreshSchema) {}
