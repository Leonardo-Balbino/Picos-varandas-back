import { createZodDto } from 'nestjs-zod';
import { googleAuthSchema } from 'contracts';

export class GoogleAuthDto extends createZodDto(googleAuthSchema) {}
