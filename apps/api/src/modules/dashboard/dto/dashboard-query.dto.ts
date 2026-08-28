import { createZodDto } from 'nestjs-zod';
import { dashboardQuerySchema } from 'contracts';

export class DashboardQueryDto extends createZodDto(dashboardQuerySchema) {}
