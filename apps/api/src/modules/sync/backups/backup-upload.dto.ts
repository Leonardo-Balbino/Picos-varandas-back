import { createZodDto } from 'nestjs-zod';
import {
  confirmarParteUploadBackupSchema,
  concluirUploadBackupSchema,
  iniciarUploadBackupSchema,
  prepararParteUploadBackupSchema,
} from 'contracts';

export class IniciarUploadBackupDto extends createZodDto(iniciarUploadBackupSchema) {}
export class PrepararParteUploadBackupDto extends createZodDto(prepararParteUploadBackupSchema) {}
export class ConfirmarParteUploadBackupDto extends createZodDto(confirmarParteUploadBackupSchema) {}
export class ConcluirUploadBackupDto extends createZodDto(concluirUploadBackupSchema) {}
