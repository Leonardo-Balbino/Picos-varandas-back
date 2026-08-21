import { createZodDto } from 'nestjs-zod';
import { loginSchema } from 'contracts';

export class LoginDto extends createZodDto(loginSchema) {}
