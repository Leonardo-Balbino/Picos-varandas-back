import { createZodDto } from 'nestjs-zod';
import { logoutSchema } from 'contracts';

export class LogoutDto extends createZodDto(logoutSchema) {}
