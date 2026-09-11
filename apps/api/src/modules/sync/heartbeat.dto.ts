import { createZodDto } from 'nestjs-zod';
import { agenteHeartbeatSchema } from 'contracts';

export class HeartbeatDto extends createZodDto(agenteHeartbeatSchema) {}
