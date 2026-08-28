import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  fechado: boolean;
  expiraEm: number;
}

/**
 * Fatia H2-infra (Card H2), antecipada para a Fase 1 do plano de hoje: só a
 * checagem de "este mês está trancado?", usada pelo PeriodoGuard desde o
 * primeiro endpoint de escrita de D/E/F/G. O CRUD completo de abrir/fechar
 * mês (H1 + resto de H2 — cálculo de saldo consolidado, sequencialidade,
 * justificativa de destrave) entra na Fase 4, quando todos os módulos que
 * ele consolida (conciliação, financeiro, caixa) já existirem.
 *
 * Cache em memória de 60s (seção do Card H2): consultar `fechamentos_mensais`
 * a cada escrita seria uma query extra em toda mutação da API. Com
 * `max-instances`/réplicas efetivamente 1 nesta topologia (Railway com
 * volume — ver Card A4), não existe o cenário de múltiplas instâncias
 * vendo caches desatualizados entre si; mesmo que houvesse, o documento
 * aceita explicitamente uma janela de até 60s de imprecisão nessa direção
 * (trancar/destrancar são operações raras e administrativas).
 */
@Injectable()
export class FechamentoService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly prisma: PrismaService) {}

  /** @param competencia formato "AAAA-MM". */
  async isCompetenciaFechada(competencia: string): Promise<boolean> {
    const cacheado = this.cache.get(competencia);
    if (cacheado && cacheado.expiraEm > Date.now()) {
      return cacheado.fechado;
    }

    const { ano, mes } = this.parseCompetencia(competencia);
    const fechamento = await this.prisma.fechamentoMensal.findUnique({
      where: { ano_mes: { ano, mes } },
      select: { trancado: true },
    });
    const fechado = fechamento?.trancado ?? false;

    this.cache.set(competencia, { fechado, expiraEm: Date.now() + CACHE_TTL_MS });
    return fechado;
  }

  /** Chamado pelo CRUD de trancar/destrancar (Fase 4) depois de gravar a
   * mudança — sem isto, uma trava/destrava recém-feita só refletiria nas
   * próximas escritas depois de até 60s, o que é surpreendente para quem
   * acabou de clicar em "trancar" e esperaria efeito imediato. */
  invalidarCache(competencia: string): void {
    this.cache.delete(competencia);
  }

  private parseCompetencia(competencia: string): { ano: number; mes: number } {
    const [anoStr, mesStr] = competencia.split('-');
    return { ano: Number(anoStr), mes: Number(mesStr) };
  }
}
