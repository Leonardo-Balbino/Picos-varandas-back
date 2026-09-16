# Multi-stage, imagem final enxuta (Card A1, seção 3.5).
#
# Posicionado na RAIZ do monorepo, não em apps/api/, porque o build precisa
# do contexto inteiro (para COPY pnpm-workspace.yaml e packages/contracts) e
# `gcloud run deploy --source .` só detecta um Dockerfile na raiz do diretório
# apontado por --source. Rodar sempre a partir da raiz do repositório.

# ---------- build ----------
FROM node:22-bookworm-slim AS builder
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

# Poda MÍNIMA de peso morto (não a poda agressiva de sessões anteriores —
# ver decisão abaixo). `prisma` entra como dependência real de apps/api
# (não só peer transitivo de @prisma/client) precisamente para que
# `pnpm deploy --filter api --prod` o inclua com `.bin/prisma` linkado —
# sem isso o binário nem existe na imagem (`Cannot find module
# '.../node_modules/.bin/prisma'`).
#
# DECISÃO VALIDADA COM DOCKER REAL (antes só simulada fora de container,
# nunca teve como confirmar): tentei podar Prisma Studio
# (@prisma/studio-core, ~120 MB de React/Radix/@visx) e o banco local
# embutido (@prisma/dev, puxa effect/fast-check/pglite/remeda/valibot) como
# sessões anteriores pretendiam. Não dá. `prisma/build/cli.js` importa os
# dois **incondicionalmente no topo do arquivo**, antes de despachar para
# qualquer subcomando — não é lazy "só dentro de `studio`/`dev`" como o
# comentário antigo desta seção supunha (nunca tinha sido testado com
# Docker de verdade). Puro `node .../cli.js --version` já quebra com
# `Cannot find module '@prisma/studio-core/...'` ou
# `'@prisma/dev/internal/state'` se qualquer um dos dois estiver ausente —
# e cada um deles carrega sua própria árvore pesada (effect precisa de
# fast-check e jiti; @prisma/config, usado por QUALQUER comando pra ler
# prisma.config.ts, também importa effect diretamente). Não existe
# meio-termo: ou a árvore inteira de Studio+Dev fica (imagem ~390 MB, CLI
# funcional) ou ela sai inteira (imagem ~100 MB, mas nenhum comando do
# `prisma` roda — nem `--version`, nem `migrate deploy`, nem `--help`).
#
# Escolhido: manter o CLI funcional (imagem maior) para que o Pre-Deploy
# Command do Railway rode `prisma migrate deploy` dentro do próprio
# container, sem depender de uma máquina local com DATABASE_PUBLIC_URL.
# Isso substitui a prática anterior documentada ("migrations aplicadas da
# máquina local") — atualizar o Pre-Deploy Command do serviço no Railway
# para `./node_modules/.bin/prisma migrate deploy --config
# apps/api/prisma.config.ts` ao adotar esta imagem.
#
# Só podamos o que ficou provado, com `docker run` real (não só `pnpm why`
# — ver acima o motivo de isso não bastar), como inalcançável por
# `prisma migrate deploy`/`--version`/`--help`:
#   - @prisma/get-platform@7.2.0 (só a 7.9.1, usada de fato, fica)
#   - typescript@5.9.3 (só do @nestjs/cli, devDependency de build)
#   - mysql2, ajv, find-my-way (introspecção MySQL / servidor HTTP do
#     Studio — não exercitados por migrate/version/help mesmo com Studio
#     presente; entrypoints internos deles não são tocados fora do
#     subcomando `studio`, diferente do require de topo de cli.js)
#   - @types/lodash (tipos, nunca runtime)
# Cada um confirmado individualmente rodando `migrate deploy --help` e
# `--version` depois de removido, não só `pnpm why` — a mesma lição do
# achado abaixo sobre `iconv-lite`.
#
# Armadilha real encontrada numa sessão anterior (mantida como registro):
# a primeira versão desta lista incluía `iconv-lite@*`, com base num
# `pnpm why iconv-lite` truncado (`| head -8`) que só mostrou o ramo
# @nestjs/cli (devDependency). Um segundo ramo — body-parser → express →
# @nestjs/platform-express — não apareceu, e como só existe UMA versão de
# iconv-lite no lockfile, apagá-la quebrou o driver HTTP em runtime
# (`docker run` falhou com "No driver (HTTP) has been selected"). `docker
# build` passou normal; só o `docker run` expôs o problema — por isso toda
# entrada desta lista, incluindo as atuais, precisa ser validada rodando a
# imagem, não só inspecionando a árvore de dependências declarada.
RUN find /out/node_modules/.pnpm -maxdepth 1 \( \
      -name "@prisma+get-platform@7.2.0*" -o \
      -name "typescript@5.9.3*" -o \
      -name "mysql2@*" -o \
      -name "ajv@*" -o \
      -name "find-my-way@*" -o \
      -name "@types+lodash@*" \
    \) -exec rm -rf {} + \
  && find /out/node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/runtime \
      -name "query_compiler_*" \
      ! -name "query_compiler_fast_bg.postgresql.js" \
      ! -name "query_compiler_fast_bg.postgresql.wasm-base64.js" \
      -delete

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production TZ=UTC FIREBIRD=/opt/firebird LD_LIBRARY_PATH=/opt/firebird/lib
RUN groupadd -r app && useradd -r -g app app

# Dependências para extração e execução do Firebird 2.5 (ODS 11.2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates libncurses6 python3 \
  && mkdir -p /opt/firebird \
  && curl -sSL "https://github.com/FirebirdSQL/firebird/releases/download/R2_5_9/FirebirdCS-2.5.9.27139-0.amd64.tar.gz" -o /tmp/fb.tar.gz \
  && tar -xzf /tmp/fb.tar.gz -C /tmp \
  && tar -xzf /tmp/FirebirdCS-2.5.9.27139-0.amd64/buildroot.tar.gz -C / \
  && rm -rf /tmp/fb.tar.gz /tmp/FirebirdCS* \
  && ln -sf /usr/lib/x86_64-linux-gnu/libncursesw.so.6 /opt/firebird/lib/libncurses.so.5 \
  && chown -R app:app /opt/firebird \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=app:app /out ./
COPY --from=builder --chown=app:app /app/apps/api/dist ./dist
COPY --from=builder --chown=app:app /app/apps/api/prisma ./prisma
# prisma.config.ts, não só a pasta prisma/: é onde datasource.url vem de
# DIRECT_URL/DATABASE_URL (Prisma 7 — schema.prisma não declara url própria,
# ver prisma.config.ts). Faltando, `prisma migrate deploy` dentro do
# container falha com "Config file not found" antes de sequer tentar
# conectar — achado rodando o Pre-Deploy Command real via `docker run`, não
# só o `nest build`/`docker build` passando. Carregado em runtime via
# `jiti` (mantido na poda acima), não precisa de um passo de compilação
# separado.
COPY --from=builder --chown=app:app /app/apps/api/prisma.config.ts ./prisma.config.ts
# Card A4 — ponto de montagem do volume de storage, criado (e com dono
# certo) ANTES do volume ser montado: um volume Docker/Railway nomeado
# herda o dono/permissão do diretório já existente na imagem na primeira
# montagem; sem isto o Docker cria o ponto de montagem como root e o
# processo (USER app, não-root) não consegue escrever nele.
RUN mkdir -p /data/arquivos && chown -R app:app /data/arquivos
USER app
EXPOSE 8080
CMD ["node", "dist/main.js"]

