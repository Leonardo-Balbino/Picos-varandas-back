# Estado do Projeto — Restaurante Varanda (Backend)

**Gerado em:** 28/08/2026, lendo o código real (não a spec, não memória de sessões anteriores).
**Branch atual:** `feat/backend-completo-fases-1-5` (não mesclada em `main`, não subida ao GitHub).

> ⚠️ **Aviso sobre este documento**: houve trabalho ativo em paralelo (outra sessão) enquanto este
> levantamento era feito — parte relevante do que está descrito aqui **existe no disco mas ainda não
> foi commitada** (ver seção 8). Isto é um retrato de um momento específico, não um estado
> permanentemente fixo. Se você ler isto depois de mais mudanças terem acontecido, confie mais no
> `git log`/`git status` reais do que neste arquivo.

---

## 1. O que é este sistema

Sistema de gestão financeira e conciliação bancário-fiscal sob medida para o Restaurante Varanda.
Resolve a conferência entre as vendas registradas no PDV local (sistema legado Dontec, banco Windows
no restaurante) e o que efetivamente entra/sai nos extratos bancários, adquirentes de cartão e
gateways de Pix — além de centralizar Contas a Pagar, Contas a Receber, Caixa Físico (cofre) e
Fechamento Mensal auditado.

**Monoloja**: dedicado exclusivamente ao Restaurante Varanda. Não existe conceito de múltiplas
lojas/empresas no backend (isso foi uma correção em relação a uma versão de spec ainda mais antiga).

**Dois consumidores da API:**
1. O **frontend web** (repo separado `Picos-Varandas-front`, Vue 3) — usuários humanos, login/senha
   ou Google, JWT.
2. O **agente Python local** (roda no computador do restaurante, ainda **não construído** — ver
   seção 7) — autenticação por HMAC, envia vendas do PDV e heartbeats.

---

## 2. Arquitetura e hospedagem

| Camada | Escolha | Observação |
|---|---|---|
| Runtime | Node 22, NestJS 11 | Monorepo pnpm: `apps/api`, `apps/web` (vazio — frontend é outro repo), `packages/contracts` |
| ORM | Prisma 7 (gerador `prisma-client`, sem engine Rust) | Driver adapter `@prisma/adapter-pg` — client conecta via `pg`, não binário nativo |
| Banco | PostgreSQL | Em produção: Railway. Local: container `postgres:16-alpine` via `docker-compose.yml` |
| Validação | Zod, schemas em `packages/contracts` | `class-validator` **proibido** no projeto |
| Deploy | **Railway** (Dockerfile na raiz) | A spec original previa Google Cloud Run + Neon + Cloudflare R2 — **isso foi trocado**. `README.md` e `.env.example` ainda mencionam Cloud Run/Secret Manager em alguns pontos — desatualizados, ignorar. |
| Storage de arquivo | **Volume persistente do Railway** (`StorageService`, disco local) | Também trocado — a spec original previa Cloudflare R2 com URL pré-assinada. Decisão consciente desta fase do projeto: upload passa pela própria API (multipart), não é direto do cliente pro storage. |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | Só valida (install → prisma generate → lint → build → test). **Não faz deploy nem migração** — deploy é a integração nativa GitHub↔Railway; migração roda como Pre-Deploy Command do próprio serviço Railway, usando a CLI do Prisma preservada na imagem de runtime. |

### Variáveis de ambiente que a API espera
`DATABASE_URL`, `DIRECT_URL` (Postgres), `JWT_SECRET` (obrigatória, API não sobe sem ela),
`GOOGLE_CLIENT_ID` (opcional — sem ela, login Google responde 500), `AGENT_HMAC_SECRET`
(obrigatória para as rotas do agente), `CORS_ORIGIN` (lista separada por vírgula, sem ela CORS fica
desabilitado), `STORAGE_DIR` (opcional, default para um diretório dentro do próprio processo — em
produção real precisa apontar para o volume montado), `PORT` (injetada pela plataforma).

`apps/api/.env.example` está desatualizado (ainda fala de Cloud Run/Secret Manager, não lista
`AGENT_HMAC_SECRET` nem `STORAGE_DIR`) — não confiar nele cegamente.

### Como rodar localmente
```bash
docker compose up -d postgres          # sobe o Postgres
docker compose run --rm migrate        # aplica as migrações (usa a mesma imagem de produção)
docker compose up -d api               # sobe a API em http://localhost:8080
```
Usuário de teste seed: `admin@varanda.local` / `TrocarSenha123` (com `precisaTrocarSenha: true`).

---

## 3. Convenções centrais do sistema (o que todo módulo novo segue)

- **Dinheiro nunca é `Float`.** Toda coluna monetária é `Decimal(14,2)`. Cálculo em `Prisma.Decimal`
  (`common/money.ts`), comparação com `.equals()`, conversão pra `number` só na borda da resposta.
- **Fuso horário**: container roda em UTC. Instantes (timestamps) são sempre UTC no banco. Toda
  agregação "por dia" ou "por mês" converte explicitamente para `America/Sao_Paulo`
  (`common/tz.ts`) — nunca assume que o dia civil bate com o dia UTC.
- **Autenticação**: JWT de 15 min (`Authorization: Bearer`) + refresh token opaco rotativo de 7
  dias. RBAC de dois perfis (`admin`/`operador`) via `RolesGuard` global — rota é autenticada por
  padrão, `@Public()` libera, `@Roles('admin')` restringe.
- **Trava de período**: `PeriodoGuard` global, opt-in via `@CompetenciaFrom('body.campo')` —
  bloqueia escrita num mês com fechamento trancado (`422 PERIOD_LOCKED`), com cache de 60s pra não
  bater no banco em toda mutação.
- **Auditoria**: toda mutação relevante é marcada com `@Audita('entidade')` — grava quem fez o quê,
  quando, payload antes/depois (campos sensíveis redigidos). Mutações multi-tabela gravam a
  auditoria dentro da própria transação (não só via interceptor) para garantir atomicidade real.
- **Erro padrão**, em toda rota sem exceção:
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": {}, "traceId": "uuid" } }
  ```
- **Idempotência por hash**: ingestão de vendas (agente) e importação de extrato usam upsert/hash de
  duplicidade — reenviar o mesmo dado não duplica.

---

## 4. Estado por card da spec original

| Card | Descrição | Status | Nota |
|---|---|---|---|
| A1 | Setup NestJS + Docker | ✅ Feito | Deploy Railway, não Cloud Run (decisão desta fase) |
| A2 | Modelagem do banco | ✅ Feito | 15 models, todas as entidades do domínio |
| A3 | CI/CD, secrets, migrações | ✅ Feito | GitHub Actions; migração via Pre-Deploy Command do Railway |
| A4 | Storage de arquivos | ✅ Feito | Volume Railway, não R2 (decisão desta fase) |
| A5 | Observabilidade, backup, guarda de custo | ❌ Não feito | Nenhum backup automatizado do Postgres configurado ainda |
| B1 | Login e-mail/senha + Google | ✅ Feito | |
| B2 | RBAC + auditoria | ✅ Feito | |
| C1/C2 | Dashboard executivo | ✅ Feito | Um único `GET /dashboard` cobre KPIs + gráficos |
| D1 | Parser de extrato | ✅ Feito | Só CSV (perfil PixPag) e XLSX (perfil banco tradicional) — validado com arquivos reais. **OFX e PDF não têm parser** |
| D2 | Painel duplo (leitura) | ✅ Feito | |
| D3 | Conciliação manual (vínculo) | ✅ Feito | |
| D4 | Match automático | ⚠️ Parcial | Implementado como match 1:1 por proximidade de valor — não confirmei se cobre as 3 regras completas da spec (Pix 1:1, lote de cartão com janela D+N, depósito de numerário). Revisar código antes de considerar equivalente à spec original. |
| E1/E2 | Contas a pagar + baixa | ✅ Feito | |
| F1 | Contas a receber | ✅ Feito | Só leitura, como a spec pede (alimentado por conciliação) |
| G1 | Caixa físico/cofre | ✅ Feito | |
| H1/H2 | Fechamento mensal + trava | ✅ Feito | Grade anual, trancar/destrancar, guard de período |
| I1 | Ingestão de vendas do agente | ✅ Feito | HMAC-SHA256, testado com dados reais |
| I2 | Heartbeat do agente | ❌ Não feito | Só o model Prisma existe, sem endpoint |
| I3 | Agente Python (executável) | ❌ Não feito, fora de escopo por decisão sua | |
| I4 | Backup do PDV legado (endpoints) | ❌ Não feito | Só o model Prisma existe, sem endpoint |
| J1 | Usuários + config (taxas, categorias) | ✅ Feito | |
| L1 | Frontend deploy | — | Repo separado (`Picos-Varandas-front`), fora deste backend |

**Resumo:** de ~24 cards de backend aplicáveis (excluindo I3, que é o agente desktop), **20 estão
prontos**, 1 parcial (D4), 3 não começados (A5, I2, I4).

---

## 5. Endpoints reais hoje (confirmado subindo a aplicação de verdade)

```
Público (sem autenticação):
  POST /api/v1/auth/login
  POST /api/v1/auth/google
  POST /api/v1/auth/refresh
  GET  /api/v1/health/live
  GET  /api/v1/health/ready

Autenticado (qualquer perfil):
  GET  /api/v1/auth/me
  POST /api/v1/auth/trocar-senha
  POST /api/v1/auth/logout
  GET  /api/v1/fechamentos
  POST /api/v1/arquivos/upload
  GET  /api/v1/arquivos/:id/download
  GET  /api/v1/dashboard
  GET  /api/v1/financeiro/contas-pagar
  POST /api/v1/financeiro/contas-pagar
  PATCH /api/v1/financeiro/contas-pagar/:id
  POST /api/v1/financeiro/contas-pagar/:id/pagar
  GET  /api/v1/financeiro/contas-receber
  GET  /api/v1/financeiro/caixa
  GET  /api/v1/financeiro/caixa/saldo
  POST /api/v1/financeiro/caixa
  POST /api/v1/conciliacao/extratos/processar
  GET  /api/v1/conciliacao/extrato
  GET  /api/v1/conciliacao/vendas-pdv
  POST /api/v1/conciliacao/vincular
  POST /api/v1/conciliacao/match-auto
  GET  /api/v1/configuracoes/categorias
  GET  /api/v1/configuracoes/taxas-gateway

Admin apenas:
  POST /api/v1/fechamentos/:anoMes/trancar
  POST /api/v1/fechamentos/:anoMes/destrancar
  GET/POST /api/v1/usuarios, PATCH /api/v1/usuarios/:id
  POST/PATCH /api/v1/configuracoes/categorias
  POST /api/v1/configuracoes/taxas-gateway

Agente local (HMAC, não Bearer):
  POST /api/v1/sync/vendas-pdv
```

---

## 6. O que falta (em ordem de provável prioridade)

1. **Revisar D4** (match automático) contra as 3 regras da spec original — o que existe é uma
   versão simplificada.
2. **I2 (heartbeat)** e **I4 (endpoints de backup do PDV legado)** — pequenos, o schema já existe.
3. **A5** — backup automatizado do Postgres (o Railway pode ter backup nativo dependendo do plano;
   confirmar antes de construir algo customizado) e alerta de uso/custo.
4. **OFX e PDF** no parser de extrato — sem amostra real ainda, não dá pra especificar direito.
5. **Testes para os módulos novos** — hoje só há teste automatizado para infraestrutura transversal
   (guards, dinheiro, fuso, storage) e os parsers de extrato. `auth`, `usuarios`, `financeiro`,
   `conciliacao` (controller), `configuracoes`, `dashboard`, `fechamento` (controller) **não têm
   nenhum teste automatizado** hoje, apesar de implementados.
6. **README.md desatualizado** — ainda descreve o projeto no estado do Card A1 (diz "não há
   autenticação", "não há entidades no schema"). Precisa reescrita completa.
7. **Endpoint de leitura de auditoria** — a trilha é gravada, mas não existe `GET /auditoria` pra
   consultar.
8. **Agente Python (I3)** — não é escopo do backend, mas é o próximo passo do projeto como um todo.

---

## 7. Qualidade — verificado agora, rodando de verdade

- `pnpm build:api` — build limpo, sem erro.
- `pnpm lint:api` — sem apontamento.
- `pnpm --filter api test` — **61 testes, todos passando**, em 10 arquivos (concentrados em guards,
  dinheiro, fuso, storage e nos dois parsers de extrato — ver item 5 da seção 6 sobre a lacuna de
  teste nos módulos de negócio mais novos).
- Boot real da aplicação compilada (`node dist/main.js`) — sobe sem erro, todas as rotas acima
  mapeadas, grafo de injeção de dependência resolve sem ciclo/faltante.

---

## 8. ⚠️ Atenção — trabalho não commitado

No momento deste levantamento, o `git status` mostrava uma quantidade grande de trabalho **só no
disco, não commitado**: os controllers/services inteiros de `dashboard`, `financeiro`,
`conciliacao` (D2/D3/D4), `usuarios`, o módulo `configuracoes` inteiro, e os schemas de contrato
correspondentes em `packages/contracts`. Tudo isso builda, linta e passa nos testes existentes — mas
**não está protegido por commit**. Recomendo fortemente commitar esse trabalho o quanto antes (antes
de qualquer `git checkout`, troca de branch, ou operação destrutiva) para não correr risco de perda.

Último commit real: `fdd0234` (28/08, "storage local + parser de extrato"). Branch:
`feat/backend-completo-fases-1-5`, local, não sincronizada com o GitHub.

---

## 9. Como isto se encaixa com o resto do projeto

- **Frontend** (`Picos-Varandas-front`): já tem todas as telas construídas, hoje ainda majoritariamente
  em cima de mock local, com o módulo `auth` (login, troca de senha) já plugado contra este backend
  de verdade. Dois documentos vivem lá: `INTEGRACAO_BACKEND.md` (como plugar cada endpoint, contratos
  exatos) e `ALINHAMENTO_BACKEND.md` (o que precisa mudar no frontend existente — remoção de
  `lojaId`, enum de perfil, etc.).
- **Agente desktop** (Card I3): ainda não iniciado. É o próximo grande bloco de trabalho do projeto
  como um todo — os endpoints que ele vai consumir (`/sync/vendas-pdv` pronto; heartbeat e backup
  ainda faltam, ver seção 6) precisam ser fechados antes ou junto dele.
