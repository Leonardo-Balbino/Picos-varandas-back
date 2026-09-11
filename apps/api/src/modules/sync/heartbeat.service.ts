import { Injectable } from '@nestjs/common';
import type { AgenteHeartbeatInput } from 'contracts';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class HeartbeatService {
  constructor(private readonly prisma: PrismaService) {}

  async registrar(input: AgenteHeartbeatInput): Promise<{ ok: true }> {
    await this.prisma.agenteHeartbeat.create({
      data: {
        versaoAgente: input.versaoAgente,
        metricas: input.metricas as Prisma.InputJsonValue | undefined,
      },
    });
    return { ok: true };
  }
}
