import { Controller, Get, Query } from '@nestjs/common';
import type { DashboardMobileResumo, DashboardResumo } from 'contracts';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DashboardMobileQueryDto } from './dto/dashboard-mobile-query.dto';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async resumo(@Query() query: DashboardQueryDto): Promise<DashboardResumo> {
    return this.dashboardService.resumo(query);
  }

  @Get('executivo-mobile')
  async resumoMobile(@Query() query: DashboardMobileQueryDto): Promise<DashboardMobileResumo> {
    return this.dashboardService.resumoMobile(query);
  }
}
