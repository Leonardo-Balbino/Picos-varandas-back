# Multi-stage, imagem final enxuta (Card A1, seção 3.5).
#
# Posicionado na RAIZ do monorepo, não em apps/api/, porque o build precisa
# do contexto inteiro (para COPY pnpm-workspace.yaml e packages/contracts) e
# `gcloud run deploy --source .` só detecta um Dockerfile na raiz do diretório
# apontado por --source. Rodar sempre a partir da raiz do repositório.

# ---------- build ----------
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable

# pnpm-workspace.yaml é copiado aqui (o snippet original da seção 3.5 do
# documento não o incluía) — sem ele, `pnpm install` não reconhece
# apps/api e packages/contracts como workspaces e o build falha.
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile

COPY . .
# node_modules/.bin/prisma direto, não `pnpm exec prisma`: `pnpm exec` roda
# uma checagem de sincronismo de deps que, sem TTY (todo build Docker), pode
# abortar pedindo confirmação em vez de só rodar o comando.
RUN pnpm --filter contracts build \
  && ./node_modules/.bin/prisma --config apps/api/prisma.config.ts generate \
  && pnpm --filter api build \
  && pnpm deploy --filter api --prod --legacy /out

# Poda de peso morto que `pnpm deploy --prod` não remove sozinho (Card A1,
# meta de imagem abaixo de 200 MB). `@prisma/client` mantém uma peer
# dependency opcional em `prisma` (o pacote CLI) mesmo em runtime; como
# workspace inteiro tem `prisma` instalado (para `generate`/`migrate`),
# pnpm linka o peer — e junto vem `prisma` inteiro: Prisma Studio
# (@prisma/studio-core + React/Radix/@visx, ~120 MB), `@prisma/dev`
# (banco local embutido, puxa `effect`, `@electric-sql/pglite`, `mysql2`,
# `ajv`, `find-my-way`, os pacotes `@prisma/*-engine*` de introspecção) e o
# binário Rust da schema engine (~22 MB).
#
# Sessão 3 (Railway): a linha "nunca pelo client em runtime" acima só era
# verdade porque `migrate deploy` rodava fora do container (Cloud Run:
# imagem some no cold start, então CLI *precisava* ficar de fora — imagem
# menor = boot mais rápido). No Railway o container é fixo e o Pre-Deploy
# Command roda comandos DENTRO dele — sem a CLI, `prisma migrate deploy`
# não tem binário para executar e migração nenhuma sai do papel. A poda
# abaixo foi reduzida para não apagar mais o pacote `prisma` em si, nem o
# binário da schema engine, nem as duas dependências que a schema engine
# usa para se localizar (`@prisma/fetch-engine`, e só a versão 7.9.1 de
# `@prisma/get-platform` — a 7.2.0 é usada exclusivamente por `@prisma/dev`
# e continua saindo) — confirmado com `pnpm why` que essas quatro entradas
# (prisma, @prisma/engines, @prisma/fetch-engine, @prisma/get-platform@7.9.1)
# são exatamente a árvore de dependência de `prisma migrate deploy`, nada
# a mais. `typescript@6.0.3` também fica (é dependência declarada do
# próprio `prisma`/`@prisma/client`, diferente do `typescript@5.9.3` do
# `@nestjs/cli`, que segue de fora). Prisma Studio (@prisma/studio-core) e
# o banco local embutido (@prisma/dev + effect + pglite) continuam podados
# — nenhum dos dois entra no caminho de `migrate deploy`.
#
# Ressalva importante: `pnpm why` prova a árvore de dependências declarada,
# não prova o que o bundle minificado da CLI (`build/cli.js`) de fato
# executa no boot — encontrei `require("@prisma/studio-core/...")` dentro
# dele, então a poda do Studio (mantida abaixo) descansa na suposição de
# que esse require é lazy (só roda dentro do comando `studio`, nunca em
# `migrate deploy`). Sem Docker disponível no ambiente em que isso foi
# escrito, essa suposição NÃO foi validada com um `docker run` real. Antes
# de apontar o Pre-Deploy Command do Railway para `prisma migrate deploy`
# de verdade, rodar `docker build` + `docker run <imagem> node
# node_modules/.bin/prisma migrate deploy --help` (sem banco real,
# só para confirmar que a CLI sobe sem estourar `MODULE_NOT_FOUND`) — a
# mesma disciplina de "build passa, run é que prova" já documentada abaixo.
#
# A lista abaixo (Sessão 2, Card B1) foi ampliada depois do primeiro
# `docker build` REAL desta imagem — as sessões anteriores nunca tinham
# rodado Docker de verdade (só simulado fora de container), e o build real
# saiu em 433 MB, mais que o dobro da meta. Cada entrada nova foi
# confirmada com `pnpm why <pacote>` mostrando que a ÚNICA rota até ela é
# `@prisma/studio-core`/`@prisma/dev`/`@nestjs/cli` (build-time) — nada
# alcançável por `dist/main.js`. `iconv-lite` e `ajv@6` em particular só
# existem via `@nestjs/cli` (devDependency, ferramenta de build, nunca
# roda em runtime). Nada disso é alcançável pelo código da aplicação —
# medido e validado rodando a imagem podada de ponta a ponta (boot,
# health checks, login, refresh) antes de considerar resolvido.
#
# Armadilha real encontrada aqui: a primeira versão desta lista incluía
# `iconv-lite@*`, com base num `pnpm why iconv-lite` cuja saída eu truncei
# (`| head -8`) e só vi o primeiro ramo (@nestjs/cli, devDependency). Um
# segundo ramo — body-parser → express → @nestjs/platform-express — não
# apareceu no que eu li, e como só existe UMA versão de iconv-lite no
# lockfile, apagá-la quebrou o driver HTTP em runtime (`docker run` falhou
# com "No driver (HTTP) has been selected"). `docker build` passou normal;
# só o `docker run` expôs o problema — exatamente o motivo de validar as
# duas etapas, não só a primeira. Todo nome nesta lista foi reverificado com
# `pnpm why <pacote>` SEM truncar a saída, conferindo que toda raiz passa só
# por @prisma+studio-core/@prisma+dev/@nestjs+cli.
RUN find /out/node_modules/.pnpm -maxdepth 1 \( \
      -name "@prisma+studio-core@*" -o \
      -name "@prisma+dev@*" -o \
      -name "@prisma+query-plan-executor@*" -o \
      -name "@prisma+streams-local@*" -o \
      -name "@prisma+get-platform@7.2.0*" -o \
      -name "effect@*" -o \
      -name "@electric-sql+pglite@*" -o \
      -name "@electric-sql+pglite-tools@*" -o \
      -name "@radix-ui+*" -o \
      -name "@visx+*" -o \
      -name "react@*" -o \
      -name "react-dom@*" -o \
      -name "elkjs@*" -o \
      -name "remeda@*" -o \
      -name "fast-check@*" -o \
      -name "valibot@*" -o \
      -name "jiti@*" -o \
      -name "typescript@5.9.3*" -o \
      -name "mysql2@*" -o \
      -name "ajv@*" -o \
      -name "find-my-way@*" -o \
      -name "csstype@*" -o \
      -name "d3-geo@*" -o \
      -name "d3-shape@*" -o \
      -name "@types+lodash@*" \
    \) -exec rm -rf {} + \
  && find /out/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/runtime \
      -name "query_compiler_*" \
      ! -name "query_compiler_fast_bg.postgresql.js" \
      ! -name "query_compiler_fast_bg.postgresql.wasm-base64.js" \
      -delete

# ---------- runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production TZ=UTC
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /out ./
COPY --from=builder --chown=app:app /app/apps/api/dist ./dist
COPY --from=builder --chown=app:app /app/apps/api/prisma ./prisma
USER app
EXPOSE 8080
CMD ["node", "dist/main.js"]
