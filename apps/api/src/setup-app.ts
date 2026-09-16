import type { INestApplication } from '@nestjs/common';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { RequestWithTraceId } from './common/types/request-with-trace';

/**
 * Configuração compartilhada entre o bootstrap real (main.ts) e qualquer app
 * de teste que precise exercitar o mesmo pipeline (CORS, validação, filtro
 * de exceções) — para as duas versões nunca poderem divergir. Exige que a
 * app tenha sido criada com `{ bodyParser: false }` (ver main.ts) — aqui só
 * registramos o parser, não desligamos o automático do Nest.
 */
export function configureApp(app: INestApplication): void {
  // json({ verify }): captura o corpo bruto em request.rawBody ANTES do
  // parse, para o HmacAuthGuard (Card I1) recalcular a assinatura HMAC do
  // agente local sobre exatamente os mesmos bytes que ele assinou —
  // reserializar o body já parseado (JSON.stringify) não garante bytes
  // idênticos (ordem de chaves, espaçamento). Rotas sem HMAC simplesmente
  // não leem rawBody; nenhum custo para elas além do parser em si, que já
  // rodava de qualquer forma.
  app.use(
    json({
      limit: '1mb',
      verify: (req: RequestWithTraceId, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(urlencoded({ extended: true }));

  // Trust proxy (Sessão 2 — Railway): a aplicação roda atrás do proxy
  // reverso do Railway, então sem isto `req.ip` traz o IP interno do
  // proxy — igual para todo mundo — e o rate limit de login (Card B1,
  // 5/min) passaria a valer para TODOS os usuários somados, não por
  // usuário real. Com trust proxy habilitado, o Express lê o IP do
  // cliente a partir de X-Forwarded-For, que é o que o
  // ThrottlerGuard usa por padrão (req.ip). `1` confia em exatamente um
  // salto de proxy — o do próprio Railway na frente da aplicação.
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance.set('trust proxy', 1);
  expressInstance.disable('x-powered-by');

  // Headers de segurança HTTP essenciais
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-XSS-Protection', '0');
    next();
  });

  // Base URL: /api/v1 (seção 3.9).
  app.setGlobalPrefix('api/v1');

  // CORS com origem explícita — nunca wildcard (Card A1). credentials:false
  // porque a autenticação é via Authorization: Bearer, não cookie (Card B1).
  const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim());
  app.enableCors({
    origin: corsOrigin && corsOrigin.length > 0 ? corsOrigin : false,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      // Headers do agente local (Card I1) — sync/heartbeat.
      'X-Agent-Id',
      'X-Timestamp',
      'X-Signature',
    ],
  });

  // Validação — seção 3.10: fonte única em Zod via nestjs-zod. Cada
  // endpoint declara seu DTO com createZodDto(schema) (schema vindo de
  // packages/contracts); este pipe global só aplica o schema já anexado ao
  // DTO. Não há mais class-validator/class-transformer no projeto.
  app.useGlobalPipes(new ZodValidationPipe());

  app.useGlobalFilters(new AllExceptionsFilter());
}
