import { Controller, Get, Query } from '@nestjs/common';
import type { DashboardResumo } from 'contracts';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async resumo(@Query() query: DashboardQueryDto): Promise<DashboardResumo> {
    return this.dashboardService.resumo(query);
  }
}
