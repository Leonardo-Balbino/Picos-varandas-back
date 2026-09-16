import { createZodDto } from 'nestjs-zod';
import { dashboardMobileQuerySchema } from 'contracts';

export class DashboardMobileQueryDto extends createZodDto(dashboardMobileQuerySchema) {}
