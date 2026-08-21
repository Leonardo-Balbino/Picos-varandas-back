import { defineConfig } from 'prisma/config';

/**
 * Config do CLI do Prisma (migrate, introspect, studio — a partir do Card
 * A2). Desde o Prisma 7, `datasource.url`/`directUrl` não vivem mais em
 * schema.prisma (seção 3.4) — o runtime do PrismaClient recebe a conexão
 * via driver adapter (ver PrismaService); só o CLI usa o que está aqui.
 *
 * DIRECT_URL, não DATABASE_URL: migrações usam o endpoint direto porque o
 * pooler do Neon não suporta comandos DDL de forma confiável (seção 3.4).
 *
 * process.env direto, não o helper `env()` de prisma/config: `env()` lança
 * PrismaConfigEnvError se a variável não existir, e isso quebra `prisma
 * generate` — que não precisa de conexão real — em qualquer ambiente sem
 * DIRECT_URL definido (ex.: o estágio de build do Dockerfile, seção 3.5,
 * que não recebe segredos). `migrate`/`db push` continuam falhando de
 * forma clara se DIRECT_URL estiver ausente, só que na hora de conectar,
 * não na hora de carregar o schema.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DIRECT_URL,
  },
  migrations: {
    // `prisma db seed` / `prisma migrate dev` (que chama o seed depois de
    // aplicar migrações pendentes) rodam este comando. ts-node porque o
    // seed é TypeScript e o projeto já pina o compilador em 6.0.3 — nada de
    // depender de um segundo runner (tsx, etc.) só para isto (Card B1).
    seed: 'ts-node prisma/seed.ts',
  },
});
