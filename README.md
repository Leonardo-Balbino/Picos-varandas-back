# Restaurante Varanda — Backend

> O estado detalhado mais recente está em `ESTADO_DO_PROJETO.md`. O upload
> criptografado de backups e seu worker estão descritos em
> `DEPLOY_BACKUPS_RAILWAY.md`; partes deste README sobre o scaffold inicial e
> Google Cloud estão preservadas apenas como histórico e estão desatualizadas.

Sistema de conciliação bancário-fiscal e gestão financeira sob medida para o
Restaurante Varanda. Especificação completa: `Documentação de especificação
tecnica- Kamban v2.pdf` (Cards do Kanban, **v2.2** — inclui as correções da
Sessão 1 do backend: validação em Zod, Prisma 7, Dockerfile na raiz).

## Estado atual: Card A1 apenas

Este repositório contém **só o scaffold do Card A1** ("Setup NestJS + Docker
+ Google Cloud Run") — a estrutura modular, o pipeline de erro/validação, os
health checks e o Dockerfile. Nenhum card seguinte foi implementado ainda.
Em particular:

- **Não há entidades no schema Prisma.** `apps/api/prisma/schema.prisma` só
  tem `datasource`/`generator` — o suficiente para `prisma generate`
  funcionar no build. A modelagem completa (usuarios, vendas_pdv,
  extratos_bancarios, conciliacoes, contas_pagar, contas_receber,
  movimentacoes_caixa, fechamentos_mensais, taxas_gateway, auditoria...) é o
  **Card A2**, o próximo da fila.
- **Não há autenticação.** `AuthModule` e `UsuariosModule` existem como
  módulos vazios só para compor a estrutura da seção 3.1. Login, RBAC e
  auditoria são os Cards B1/B2.
- **Não há CI/CD, Secret Manager nem storage R2.** Deploy é manual
  (`scripts/deploy-api.sh`), secrets vão direto no Cloud Run por enquanto.
  Isso é o Card A3 (pipeline) e A4 (R2).
- Todos os outros módulos (`dashboard`, `conciliacao`, `financeiro`,
  `fechamento`, `sync`) são placeholders vazios, um por card futuro.
- **Validação é 100% Zod** (`nestjs-zod`), sem class-validator (seção 3.10).
  Ainda não há DTOs reais porque não há endpoints de negócio nesta fase —
  o pipe global (`ZodValidationPipe`) e o tratamento de `ZodError` no filtro
  de exceções já estão prontos para quando os primeiros `createZodDto()`
  chegarem, a partir do Card A2/D1.

## Estrutura

```
.
├── apps/
│   ├── api/            # NestJS — a API. Único app com código real hoje.
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── prisma.config.ts   # config do CLI (migrate/generate) — Prisma 7
│   │   └── src/
│   │       ├── common/money.ts        # Prisma.Decimal — regra monetária (3.2)
│   │       ├── setup-app.ts           # config compartilhada real/testes
│   │       ├── infra/prisma/prisma.service.ts
│   │       └── generated/prisma/      # client gerado — gitignored, não commitar
│   └── web/             # Reservado para o frontend (Card L1). Vazio.
├── packages/
│   └── contracts/       # Schemas Zod compartilhados (paginação, erro, requestSchema).
├── scripts/
│   └── deploy-api.sh    # Comando de deploy manual do Card A1.
├── Dockerfile            # Na raiz — ver nota abaixo.
├── .npmrc                # auto-install-peers=false — ver "Decisões" abaixo.
└── pnpm-workspace.yaml
```

> **Nota sobre o Dockerfile:** a seção 3.1 da especificação desenha a árvore
> de arquivos com `Dockerfile` dentro de `apps/api/`. Ele foi colocado na
> **raiz** do repositório aqui porque `gcloud run deploy --source .` só
> detecta um Dockerfile na raiz do diretório de origem, e o build precisa do
> monorepo inteiro como contexto (para copiar `packages/contracts` e
> `pnpm-workspace.yaml`).

## Rodando localmente

```bash
corepack enable   # habilita o pnpm via corepack, se ainda não estiver
pnpm install

cp apps/api/.env.example apps/api/.env
# preencha DATABASE_URL/DIRECT_URL com um Postgres local ou um branch do
# Neon — necessário para /health/ready e para `prisma generate` funcionar
# de verdade (o comando abaixo roda sem banco, mas o client gerado é
# necessário para o build compilar).

pnpm build:contracts
./node_modules/.bin/prisma --config apps/api/prisma.config.ts generate
pnpm dev:api
```

- `GET http://localhost:8080/api/v1/health/live` → `{ "status": "ok" }`,
  sem tocar no banco.
- `GET http://localhost:8080/api/v1/health/ready` → exige `DATABASE_URL`
  válido; roda `SELECT 1` via `@prisma/adapter-pg`.

Para rodar comandos do Prisma CLI (generate, migrate, studio) fora do
Docker, use sempre `--config apps/api/prisma.config.ts` — o script
`pnpm prisma:api <comando>` já faz isso (ex.: `pnpm prisma:api generate`).

## Deploy

```bash
export GCP_PROJECT_ID=<id-do-projeto>
./scripts/deploy-api.sh
```

Pré-requisito: os secrets `varanda-database-url`, `varanda-direct-url` e
`varanda-jwt-secret` já precisam existir no Secret Manager do projeto GCP
(criação automatizada disso é Card A3 — por enquanto, criar manualmente).

**Ainda não validado com Docker real** (sem daemon disponível no ambiente
onde este scaffold foi montado) — a sequência completa do `Dockerfile` foi
simulada fora de container (mesmos comandos, mesma ordem, incluindo
`pnpm deploy --prod`) e o resultado rodado como app real contra Postgres,
mas o primeiro `docker build .` de verdade ainda precisa confirmar o
tamanho final da imagem e o comportamento de rede/DNS dentro do container.

## Decisões tomadas neste scaffold que valem registrar

- **Prisma 7, gerador `prisma-client` com driver adapter
  (`@prisma/adapter-pg`)**, não o `prisma-client-js` clássico. Sem engine
  Rust para queries — bundle menor, cold start menor. Três consequências
  não óbvias, todas já resolvidas no código:
  - O client gerado vive em `apps/api/src/generated/prisma/` (não em
    `node_modules`), então **`prisma generate` precisa rodar antes de
    qualquer `tsc`/`nest build`** — inclusive localmente. `src/generated/`
    está no `.gitignore`.
  - `datasource.url`/`directUrl` **não existem mais** em `schema.prisma` na
    v7 — a conexão de runtime vem do adapter (`PrismaService`), e a conexão
    do CLI (migrate/introspect) vem de `apps/api/prisma.config.ts`, que lê
    `DIRECT_URL` via `process.env` direto (não o helper `env()` do
    `prisma/config`, que lança erro se a variável não existir — isso
    quebraria `prisma generate` no estágio de build do Docker, que não
    recebe segredos).
  - `connection_limit`/`pool_timeout` na `DATABASE_URL` **não têm mais
    efeito** — eram parâmetros do engine Rust. O pool agora é do node-pg;
    configurado em `PrismaService` (`max`, `connectionTimeoutMillis`).
    `ssl` **não é forçado** no adapter — fica a cargo de `sslmode=require`
    já presente na própria `DATABASE_URL`, para não quebrar Postgres local
    sem TLS. Se aparecer `P1010: User was denied access` contra o Neon em
    produção, é validação de certificado (node-pg não relaxa isso por
    padrão) — ver `NODE_EXTRA_CA_CERTS`, não desabilitar
    `rejectUnauthorized`.
- **`prisma` (o pacote CLI) é devDependency da RAIZ do monorepo, não de
  `apps/api`.** `@prisma/client` mantém uma peer dependency opcional em
  `prisma` mesmo em runtime; testado e confirmado que isso faz `prisma`
  (e tudo que ele carrega — Prisma Studio, `effect`, `@electric-sql/pglite`,
  a schema engine em Rust) ser puxado para dentro de `pnpm deploy --prod`
  **de qualquer forma**, esteja `prisma` em `apps/api` ou na raiz — não tem
  como evitar o link do peer só reposicionando o pacote no workspace.
  Movido mesmo assim por ser mais correto arquiteturalmente (uma versão do
  CLI para o monorepo todo); o problema real de tamanho é resolvido no
  Dockerfile (ver abaixo), não aqui.
- **Poda explícita no Dockerfile depois de `pnpm deploy --prod --legacy`.**
  Medido de verdade: sem poda, o deploy de produção da API sozinha passava
  de **380 MB**, porque a peer dependency opcional de `@prisma/client` em
  `prisma` traz o pacote inteiro — incluindo Prisma Studio (React, Radix
  UI, ~120 MB), `@prisma/dev` (banco local embutido via
  `@electric-sql/pglite`) e o binário Rust da schema engine (~22 MB, usado
  só por `migrate`/`introspect`, nunca pelo client em runtime). Nada disso
  é alcançável pelo código da aplicação. O Dockerfile remove essas pastas
  explicitamente após o deploy; medido em **~138 MB** depois da poda,
  testado rodando a imagem podada de ponta a ponta (boot, `/health/live`,
  `/health/ready` contra Postgres real, `SIGTERM`) antes de considerar
  resolvido. `--legacy` no `pnpm deploy` também é obrigatório — sem ele,
  pnpm recusa fazer deploy de um pacote com dependência de workspace
  (`contracts`) a menos que `inject-workspace-packages=true` esteja
  configurado; `--legacy` foi a opção testada e confirmada funcionando.
- **`auto-install-peers=false` no `.npmrc`.** O padrão do pnpm
  (`auto-install-peers=true`) instala silenciosamente qualquer peer
  dependency opcional de qualquer pacote do grafo. Foi assim que
  `class-validator`/`class-transformer` (peer opcional de
  `@nestjs/common`, removidos do projeto ao migrar para Zod) voltavam a
  aparecer em `pnpm deploy --prod` mesmo não estando em nenhum
  `package.json`. Resolve esse caso específico; **não** resolve o caso do
  `prisma`/Studio acima, porque ali o pacote genuinamente existe no
  workspace (é nosso devDependency), não é um peer "fantasma".
- **Validação 100% Zod via `nestjs-zod`** (seção 3.10), sem
  class-validator/class-transformer. `ZodValidationPipe` registrado
  globalmente em `setup-app.ts`; `AllExceptionsFilter` trata
  `ZodValidationException` e popula `error.fields` a partir de
  `ZodError.issues` (chave = `path.join('.')`). `packages/contracts`
  exporta `requestSchema()`, que aplica `.strict()` por padrão — equivalente
  a `whitelist + forbidNonWhitelisted` do class-validator. Testado com
  payload válido, campo faltando e campo desconhecido, todos retornando o
  envelope correto.
- **`app.enableShutdownHooks()` em `main.ts`.** Sem isso, o `onModuleDestroy`
  do `PrismaService` (que chama `$disconnect()`) nunca é acionado pelo
  `SIGTERM` que o Cloud Run manda antes de encerrar uma instância ociosa —
  e com `min-instances=0`, isso acontece o tempo todo. Testado: o log de
  desconexão aparece de verdade ao mandar `SIGTERM` no processo.
- **`PrismaService` não chama `$connect()` em `onModuleInit`** — ver
  comentário no arquivo. A seção 3.4 fala em "conectado no onModuleInit" mas
  a seção 3.6 (mitigação de cold start) e o critério de pronto do
  `/health/live` são mais específicos: nenhuma query no boot. Testado
  contra Postgres real com `pg_stat_activity`: zero conexões após o boot,
  zero após `/health/live`, exatamente uma depois do primeiro
  `/health/ready`.
- **TypeScript pinado em `6.0.3`, não na última tag (`7.x`).** O Nest CLI
  ainda depende da API programática do compilador que o TypeScript 7.0
  removeu (só volta na 7.1, sem prazo — issue confirmada no próprio
  nest-cli). Com TS 7 instalado, `nest build` falha com erro explícito
  sobre isso.
- Monorepo completo (`apps/api` + `apps/web` reservado + `packages/contracts`)
  dentro deste repositório `-back`, por decisão explícita do usuário — não
  presuma que o frontend vai morar aqui sem reconfirmar se isso mudar.
