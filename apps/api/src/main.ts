import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { cors: false });

  // A plataforma de hospedagem (Railway, desde a Sessão 2 — antes Cloud
  // Run) envia SIGTERM antes de reiniciar ou substituir a instância. Sem
  // isto, os lifecycle hooks (PrismaService.onModuleDestroy → $disconnect())
  // nunca são chamados e conexões ficam penduradas no Postgres (seção 3.4).
  app.enableShutdownHooks();

  configureApp(app);

  // Respeita a porta injetada pela plataforma — nunca fixar PORT no
  // ambiente (Sessão 2: Railway injeta, como o Cloud Run injetava antes).
  const port = Number(process.env.PORT ?? 8080);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
