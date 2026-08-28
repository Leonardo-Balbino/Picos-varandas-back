import { createZodDto } from 'nestjs-zod';
import { uploadArquivoBodySchema } from 'contracts';

export class UploadArquivoDto extends createZodDto(uploadArquivoBodySchema) {}
