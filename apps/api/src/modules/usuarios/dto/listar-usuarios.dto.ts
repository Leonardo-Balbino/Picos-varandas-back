import { createZodDto } from 'nestjs-zod';
import { listaUsuariosQuerySchema } from 'contracts';

export class ListarUsuariosDto extends createZodDto(listaUsuariosQuerySchema) {}
