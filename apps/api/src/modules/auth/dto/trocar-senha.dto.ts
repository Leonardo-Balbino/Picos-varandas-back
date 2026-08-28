import { createZodDto } from 'nestjs-zod';
import { trocarSenhaSchema } from 'contracts';

export class TrocarSenhaDto extends createZodDto(trocarSenhaSchema) {}
