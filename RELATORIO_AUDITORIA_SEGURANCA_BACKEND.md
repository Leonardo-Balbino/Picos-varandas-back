# Relatório de Auditoria de Segurança, Bugs e Estabilidade - Backend (API)

**Projeto:** Restaurante Varandas (Picos-Varandas)  
**Módulo Auditado:** `Picos-varandas-back` (NestJS 11, Prisma 7, PostgreSQL, Firebird ISQL)  
**Data da Auditoria:** 15 de Setembro de 2026  
**Status do Código:** NENHUMA linha de código foi modificada durante esta auditoria (relatório puramente diagnóstico).

---

## 1. Sumário Executivo e Matriz de Riscos

Foi realizada uma auditoria técnica e estática aprofundada em 100% dos fluxos de dados, pipelines HTTP, módulos de autenticação/autorização (RBAC/HMAC), rotinas de extração de backups Firebird, manipulação de arquivos, travas de período contábil e operações financeiras.

Foram identificados **13 pontos de atenção**, categorizados na matriz de severidade abaixo:

| ID | Categoria | Descrição | Severidade | Arquivo Afetado |
| :--- | :--- | :--- | :--- | :--- |
| **SEC-BACK-01** | Segurança | Zip Slip (Path Traversal) no descompactador nativo de backups | **CRÍTICA** | `backup-extractor.service.ts` |
| **SEC-BACK-02** | Segurança | Path Traversal potencial via `nomeOrigem` de envelopes PVA | **ALTA** | `backup-validation.worker.ts` |
| **SEC-BACK-03** | Segurança | Validação de arquivos baseada unicamente no header do cliente | **MÉDIA** | `arquivos.service.ts` |
| **SEC-BACK-04** | Segurança | Falha de revogação de privilégios JWT ao rebaixar perfil | **ALTA** | `usuarios.service.ts` / `roles.guard.ts` |
| **SEC-BACK-05** | Segurança | Ausência de Nonce/Cache Anti-Replay em autenticação HMAC | **MÉDIA** | `hmac-auth.guard.ts` |
| **SEC-BACK-06** | Segurança | Fallback permissivo de chave única sem verificação de agente | **MÉDIA** | `hmac-auth.guard.ts` |
| **SEC-BACK-07** | Segurança | Ausência de Helmet e Headers de Segurança HTTP essenciais | **BAIXA** | `setup-app.ts` |
| **BUG-BACK-01** | Negócio / Auditoria | Bypass de Trava de Período na Reconciliação Manual e Automática | **CRÍTICA** | `conciliacao.service.ts` |
| **BUG-BACK-02** | Negócio / Auditoria | Bypass de Trava de Período em Edição/Baixa de Contas a Pagar | **ALTA** | `financeiro.service.ts` |
| **BUG-BACK-03** | Arquitetura | Inexistência do endpoint documentado `resetar-senha` | **BAIXA** | `usuarios.controller.ts` |
| **PERF-BACK-01** | Estabilidade / DoS | Esgotamento de pool por transações longas sequenciais | **ALTA** | `vendas-sync.service.ts` / `extratos.service.ts` |
| **PERF-BACK-02** | Estabilidade / DoS | Memory Leak / Heap OOM em `matchAutomatico` irrestrito | **ALTA** | `conciliacao.service.ts` |
| **PERF-BACK-03** | Lógica | Conciliação automática sem filtro de proximidade temporal | **MÉDIA** | `conciliacao.service.ts` |
| **PERF-BACK-04** | Estabilidade | Ausência de Rate Limiting em rotas de processamento pesado | **MÉDIA** | `arquivos.controller.ts` / `conciliacao.controller.ts` |

---

## 2. Vulnerabilidades de Segurança Detalhadas

### [SEC-BACK-01] Zip Slip / Path Traversal no Descompactador Nativo de Backups
* **Localização:** `apps/api/src/modules/sync/backups/backup-extractor.service.ts`, Linhas 181-195
* **Severidade:** **CRÍTICA (CVSS 8.8)**
* **Mecanismo da Falha:**
  Na rotina de fallback `descompactarZipNativo()`, o serviço lê os cabeçalhos de cada arquivo do ZIP comprimido com Deflate e extrai o nome do arquivo diretamente do payload:
  ```typescript
  const fileName = buffer.subarray(offset + 30, offset + 30 + fileNameLength).toString('utf8');
  // ...
  if (!fileName.endsWith('/') && !fileName.endsWith('\\')) {
    const filePath = join(destino, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    // Escreve o arquivo no filePath resultante
  }
  ```
  O método utiliza `join(destino, fileName)` sem verificar se o caminho resultante resolve para dentro do diretório `destino`.
* **Impacto:**
  Se um arquivo ZIP contiver entradas como `../../../../etc/cron.d/malicious` ou caminhos relativos maliciosos, a descompactação poderá sobrescrever arquivos arbitrários no sistema de arquivos do servidor onde a aplicação está rodando.
* **Remediação Recomendada:**
  Validar a resolução do caminho antes de criar diretórios e gravar bytes:
  ```typescript
  const destinoNormalizado = resolve(destino);
  const caminhoFinal = resolve(join(destinoNormalizado, fileName));
  if (!caminhoFinal.startsWith(destinoNormalizado + sep)) {
    throw new AppException({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: `Tentativa de Path Traversal detectada no arquivo: ${fileName}`,
    });
  }
  ```

---

### [SEC-BACK-02] Path Traversal em `nomeOrigem` de Envelopes Criptografados PVA
* **Localização:** `apps/api/src/modules/sync/backups/backup-validation.worker.ts`, Linha 54
* **Severidade:** **ALTA (CVSS 7.5)**
* **Mecanismo da Falha:**
  O worker obtém o registro `upload` do banco de dados (gerado a partir do DTO recebido do agente local) e monta o caminho de destino do arquivo descriptografado:
  ```typescript
  const directory = join(tmpdir(), `pva-${randomUUID()}`);
  const decryptedBackupPath = join(directory, upload.nomeOrigem);
  ```
  Se o parâmetro `input.source.fileName` no início do upload contiver caracteres de escape de caminho (`../../algo`), o arquivo poderá ser escrito fora da pasta temporária isolada (`directory`).
* **Remediação Recomendada:**
  Forçar o uso exclusivo do nome base (`basename`):
  ```typescript
  import { basename } from 'node:path';
  const nomeSeguro = basename(upload.nomeOrigem);
  const decryptedBackupPath = join(directory, nomeSeguro);
  ```

---

### [SEC-BACK-03] Validação de Mimetype Baseada Apenas no Header do Cliente
* **Localização:** `apps/api/src/modules/arquivos/arquivos.service.ts`, Linhas 63-71
* **Severidade:** **MÉDIA (CVSS 5.3)**
* **Mecanismo da Falha:**
  A verificação de tipo de arquivo depende estritamente do valor `arquivo.mimetype` enviado pelo cliente HTTP na requisição multipart (`req.file.mimetype` do Multer):
  ```typescript
  const permitidos = MIME_PERMITIDO[contexto];
  if (!permitidos.includes(arquivo.mimetype)) {
    throw new AppException({ ... });
  }
  ```
  Não há verificação dos **magic bytes** (assinatura real dos primeiros bytes do arquivo).
* **Impacto:**
  Um usuário autenticado pode subir executáveis binários, scripts em lote ou SVGs com vetores de injeção disfarçados com cabeçalho `Content-Type: text/csv` ou `application/pdf`.
* **Remediação Recomendada:**
  Utilizar checagem de assinatura de bytes (ex.: biblioteca `file-type` ou verificação dos primeiros 4 a 8 bytes no buffer) para assegurar que um arquivo declarado como PDF começa de fato com `%PDF`, ou que XLSX possui cabeçalho PK ZIP (`0x50 0x4B 0x03 0x04`).

---

### [SEC-BACK-04] Falha de Revogação de Privilégios ao Rebaixar Perfil de Administrador
* **Localização:** `apps/api/src/modules/usuarios/usuarios.service.ts`, Linhas 76-98 e `apps/api/src/common/guards/roles.guard.ts`, Linhas 56-64
* **Severidade:** **ALTA (CVSS 7.2)**
* **Mecanismo da Falha:**
  1. No `RolesGuard`, a autorização por roles verifica a propriedade `payload.perfil` contida no Access Token JWT:
     ```typescript
     const payload = await this.authService.validarAccessToken(token);
     if (perfisExigidos && !perfisExigidos.includes(payload.perfil)) {
       throw new AppException({ status: 403, code: 'FORBIDDEN' });
     }
     ```
  2. Em `UsuariosService.atualizar()`, o campo `tokenVersion` **só é incrementado quando o usuário é desativado**:
     ```typescript
     const vaiDesativar = input.ativo === false && atual.ativo;
     // ...
     ...(vaiDesativar ? { tokenVersion: { increment: 1 } } : {})
     ```
* **Impacto:**
  Se o Administrador rebaixar um usuário de `admin` para `operador`, o `tokenVersion` desse usuário permanece inalterado. O usuário rebaixado continua executando rotas exclusivas de administrador (`@Roles('admin')`) durante toda a validade do seu token JWT (15 minutos).
* **Remediação Recomendada:**
  Incrementar o `tokenVersion` sempre que houver alteração de perfil:
  ```typescript
  const mudouPerfil = input.perfil && input.perfil !== atual.perfil;
  const deveInvalidarSessao = vaiDesativar || mudouPerfil;
  // ...
  ...(deveInvalidarSessao ? { tokenVersion: { increment: 1 } } : {})
  ```

---

### [SEC-BACK-05] Ausência de Cache/Nonce Anti-Replay em `HmacAuthGuard`
* **Localização:** `apps/api/src/common/guards/hmac-auth.guard.ts`, Linhas 50-52
* **Severidade:** **MÉDIA (CVSS 5.9)**
* **Mecanismo da Falha:**
  O guard valida a diferença temporal entre `Date.now()` e o header `X-Timestamp`:
  ```typescript
  if (Math.abs(Date.now() - timestampMs) > JANELA_ANTI_REPLAY_MS) {
    throw this.naoAutorizado('X-Timestamp fora da janela de tolerância.');
  }
  ```
  `JANELA_ANTI_REPLAY_MS` é fixada em **5 minutos (300.000 ms)**. Contudo, **não existe armazenamento/rastreamento de assinaturas já processadas** dentro dessa janela (em memória ou Redis).
* **Impacto:**
  Caso um invasor intercepte uma requisição assinada em trânsito (ou caso haja repetição de rede), a mesma requisição exata pode ser submetida e aceita dezenas de vezes dentro dos 5 minutos de tolerância.
* **Remediação Recomendada:**
  Armazenar os hashes de assinatura já vistos em um cache temporário (LRU com TTL de 5 minutos) e rejeitar assinaturas repetidas.

---

### [SEC-BACK-06] Fallback Permissivo de Chave HMAC Sem Restrição de Agente
* **Localização:** `apps/api/src/common/guards/hmac-auth.guard.ts`, Linhas 118-120
* **Severidade:** **MÉDIA (CVSS 5.4)**
* **Mecanismo da Falha:**
  Quando `AGENT_HMAC_SECRETS_JSON` não está definido, a função recorre a:
  ```typescript
  return process.env.AGENT_HMAC_SECRET;
  ```
  Neste caso, não há validação de comprimento mínimo de 32 bytes (como há no JSON), nem validação de se o `agentId` enviado no header corresponde a um agente credenciado. Qualquer identificador de agente é aceito desde que a assinatura bata com a chave global.
* **Remediação Recomendada:**
  Deprecar o fallback de chave única ou forçar a validação estrita de comprimento mínimo e whitelist de IDs de agentes.

---

### [SEC-BACK-07] Ausência de Helmet e Headers de Segurança HTTP
* **Localização:** `apps/api/src/setup-app.ts`
* **Severidade:** **BAIXA (CVSS 3.7)**
* **Mecanismo da Falha:**
  A aplicação Express não inicializa o middleware `helmet()`. Faltam cabeçalhos padronizados de segurança como `X-Content-Type-Options: nosniff`, `Strict-Transport-Security` (HSTS), `X-Frame-Options` e a desativação do cabeçalho `X-Powered-By: Express`.
* **Remediação Recomendada:**
  Adicionar `import helmet from 'helmet'` e chamar `app.use(helmet())` em `setup-app.ts`.

---

## 3. Falhas de Regra de Negócio e Violação de Auditoria Contábil

### [BUG-BACK-01] Bypass de Trava de Período Contábil na Reconciliação
* **Localização:** `apps/api/src/modules/conciliacao/conciliacao.service.ts`, Linhas 102-110 e 181-203
* **Severidade:** **CRÍTICA (Integridade Contábil / Fiscal)**
* **Mecanismo da Falha:**
  No método `vincular()`:
  ```typescript
  const competenciaHoje = dataCivilEmFusoLoja(new Date()).slice(0, 7);
  if (await this.fechamentoService.isCompetenciaFechada(competenciaHoje)) {
    throw new AppException({ status: 422, code: 'PERIOD_LOCKED' });
  }
  ```
  O sistema verifica unicamente se a competência do **dia atual** (`competenciaHoje`) está fechada!
  **Não é verificado se as vendas (`vendaPdv`) ou lançamentos de extrato (`extratoBancario`) sendo conciliados pertencem a meses fechados/trancados anteriores!**
* **Impacto:**
  Um operador pode selecionar extratos e cupons fiscais emitidos em Janeiro de 2026 (mês já auditado e trancado pelo fechamento mensal) e vinculá-los hoje (Setembro de 2026).
  Isso altera o `statusConciliacao` de `pendente` para `conciliado` em registros de períodos contábeis trancados, violando o princípio de imutabilidade de meses fechados.
* **Remediação Recomendada:**
  Extrair a competência de cada extrato e venda envolvida na transação e rejeitar a operação se qualquer uma das competências estiver fechada:
  ```typescript
  for (const extrato of extratos) {
    const comp = this.competenciaDeDataCivil(extrato.dataTransacao);
    if (await this.fechamentoService.isCompetenciaFechada(comp)) {
      throw new AppException({
        status: 422,
        code: 'PERIOD_LOCKED',
        message: `Extrato de ${comp} pertence a um período trancado.`,
      });
    }
  }
  ```

---

### [BUG-BACK-02] Bypass de Trava de Período na Alteração e Baixa de Contas a Pagar
* **Localização:** `apps/api/src/modules/financeiro/financeiro.service.ts`, Linhas 91-100 e Linhas 120-165
* **Severidade:** **ALTA (Integridade Financeira)**
* **Mecanismo da Falha:**
  1. Em `pagarContaPagar()`, o decorator `@CompetenciaFrom('body.dataPagamento')` valida se o mês em que o pagamento foi realizado está aberto. Porém, **não valida se a `dataVencimento` original da conta pertencia a um mês trancado**. O status da obrigação contábil do mês trancado muda de `pendente` para `pago` sem autorização de destrave.
  2. Em `atualizarContaPagar()`, se a conta original vencia em um mês fechado (ex: `2026-01-15`) e o usuário altera a data de vencimento para um mês aberto (ex: `2026-03-10`), o sistema valida apenas a nova data:
     ```typescript
     const novoVencimento = input.dataVencimento ? new Date(input.dataVencimento) : atual.dataVencimento;
     const competencia = this.competenciaDeDataCivil(novoVencimento);
     if (await this.fechamentoService.isCompetenciaFechada(competencia)) { ... }
     ```
     O sistema **não valida se a competência anterior (`atual.dataVencimento`) estava fechada**. Permitindo remover uma dívida pendente de um mês fechado sem qualquer restrição.
* **Remediação Recomendada:**
  Exigir que tanto a competência original quanto a nova competência estejam abertas antes de permitir a alteração ou baixa.

---

### [BUG-BACK-03] Ausência do Endpoint de Reset de Senha pelo Administrador
* **Localização:** `apps/api/src/modules/usuarios/usuarios.controller.ts`
* **Severidade:** **BAIXA (Inconsistência Arquitetural)**
* **Mecanismo da Falha:**
  O schema do Prisma e a documentação do Card J1 mencionam a flag `precisaTrocarSenha` sendo acionada por `POST /usuarios/:id/resetar-senha`. Contudo, esse endpoint não existe no controller de usuários. Apenas a troca voluntária pelo próprio usuário (`POST /auth/trocar-senha`) está implementada.

---

## 4. Fragilidades de Desempenho, Estabilidade e Negação de Serviço (DoS)

### [PERF-BACK-01] Esgotamento de Pool e Timeouts por Transações Longas Sequenciais
* **Localização:** `apps/api/src/modules/sync/vendas/vendas-sync.service.ts` e `apps/api/src/modules/conciliacao/extratos/extratos.service.ts`
* **Severidade:** **ALTA**
* **Mecanismo:**
  Em lotes de sincronização de vendas (400 itens) ou processamento de extratos com milhares de linhas, o sistema executa queries individuais em loop sequencial (`for ... await tx.findUnique ... await tx.create`) dentro de uma única transação Prisma (`$transaction(async (tx) => ...)`):
  - Em um lote de 400 vendas, ocorrem entre **400 e 800 roundtrips de rede** com o banco de dados.
  - O timeout de transação precisa ser aumentado para 30s a 60s.
  - Cada transação aberta mantém uma conexão exclusiva do pool do PostgreSQL presa por até dezenas de segundos.
* **Impacto:**
  Sob carga concorrente moderada (múltiplos workers ou sincronizações simultâneas), o pool de conexões do Prisma/PostgreSQL se esgota rapidamente, gerando erro `Timed out waiting for connection from pool` e travando a API inteira.
* **Remediação Recomendada:**
  Utilizar operações em lote:
  1. Carregar todos os IDs externos existentes com um único `tx.vendaPdv.findMany({ where: { idExternoPdv: { in: ids } } })`.
  2. Realizar inserções em massa via `createMany` ou upsert em chunks paralelos controlados.

---

### [PERF-BACK-02] Risco de Heap Out-Of-Memory (OOM) em `matchAutomatico`
* **Localização:** `apps/api/src/modules/conciliacao/conciliacao.service.ts`, Linhas 181-203
* **Severidade:** **ALTA**
* **Mecanismo:**
  ```typescript
  const [vendasPendentes, extratosPendentes] = await Promise.all([
    this.prisma.vendaPdv.findMany({ where: { statusConciliacao: 'pendente' } }),
    this.prisma.extratoBancario.findMany({ where: { statusConciliacao: 'pendente' } }),
  ]);
  ```
  A consulta não possui cláusula `take`, nem limite de data, nem paginação. Conforme o volume do restaurante atinge dezenas de milhares de vendas pendentes ao longo dos meses, a consulta consome centenas de megabytes de memória RAM no processo Node.js, culminando em crash por OOM (`JavaScript heap out of memory`).
  Além disso, para cada par encontrado, uma transação Prisma separada é disparada sequencialmente (`await this.vincular(...)`).
* **Remediação Recomendada:**
  Restringir a busca de pendências por uma janela de datas configurável (ex.: últimos 30 a 60 dias) e limitar a quantidade máxima de itens analisados por execução (ex.: `take: 500`).

---

### [PERF-BACK-03] Conciliação Automática Sem Proximidade Temporal
* **Localização:** `apps/api/src/modules/conciliacao/conciliacao.service.ts`, Linhas 190-198
* **Severidade:** **MÉDIA (Consistência Operacional)**
* **Mecanismo:**
  O algoritmo atual apenas compara `Math.abs(valorExtrato - valorVenda) < TOLERANCIA_MATCH`.
  Não há conferência de datas! Um cupom de venda de R$ 85,00 emitido há 6 meses atrás pode ser casado automaticamente com um depósito bancário de R$ 85,00 realizado ontem, gerando reconciliações espúrias.
* **Remediação Recomendada:**
  Adicionar tolerância de data (ex.: data da venda e data da liquidação dentro de uma janela máxima de D+0 a D+3 dias).

---

### [PERF-BACK-04] Falta de Rate Limiting Específico em Endpoints Pesados
* **Localização:** `apps/api/src/modules/arquivos/arquivos.controller.ts` e `apps/api/src/modules/conciliacao/conciliacao.controller.ts`
* **Severidade:** **MÉDIA**
* **Mecanismo:**
  Embora o `ThrottlerGuard` global limite a API a 100 req/minuto, endpoints de alta carga de CPU/IO (`POST /arquivos/upload`, `POST /conciliacao/match-auto` e `POST /conciliacao/extratos/processar`) não possuem decorators `@Throttle()` mais restritivos.
* **Remediação Recomendada:**
  Limitar `POST /conciliacao/match-auto` a no máximo 5 requisições por minuto por usuário autenticado.

---

## 5. Resumo das Recomendações e Próximos Passos (Backend)

1. **Prioridade Crítica (P0):**
   - Corrigir a sanitização de caminhos em `descompactarZipNativo` (prevenção contra Zip Slip).
   - Validar a competência dos lançamentos contábeis originais em `conciliacao.service.ts` antes de marcar itens como conciliados.
2. **Prioridade Alta (P1):**
   - Invalidar sessões (`tokenVersion: { increment: 1 }`) ao alterar o perfil do usuário em `usuarios.service.ts`.
   - Proteger a alteração/baixa de contas a pagar contra modificação de obrigações em períodos trancados.
   - Refatorar loops síncronos de inserção unitária para queries em lote (`findMany(in)`, `createMany`).
   - Adicionar limite de datas e paginação na conciliação automática para evitar Heap Exhaustion.
3. **Prioridade Média/Baixa (P2/P3):**
   - Incluir cache anti-replay em `hmac-auth.guard.ts`.
   - Adicionar validação de magic bytes nos uploads.
   - Adicionar o middleware `helmet()`.
