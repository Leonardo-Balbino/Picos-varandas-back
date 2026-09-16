# Especificação Técnica de Backend: Dashboard Executivo Mobile
**Restaurante Varandas**  
**Data:** 15/09/2026  
**Status:** Proposta de Arquitetura e Especificação de Dados  
**Alvo:** `Picos-varandas-back` (NestJS + Prisma + PostgreSQL) & `VARANDA672.GDB` (Firebird 2.5)

---

## 1. Contexto e Objetivos de Negócio

O gestor do Restaurante Varandas (**Fernando**) necessita de visualização gerencial em tempo real e rápida via dispositivo móvel (smartphone), sem necessidade de acessar computadores desktop.

As métricas principais exigidas são:
1. **Visão Geral Diária (Hero KPIs):** Faturamento Bruto, Lucro Bruto Estimado, Ticket Médio.
2. **Benchmarking & Meta Dinâmica:** Comparativo percentual contra a média das últimas 8 semanas do mesmo dia da semana (ex: quinta vs últimas 8 quintas-feiras) e meta diária calculada dinamicamente.
3. **Evolução Diária no Mês:** Faturamento acumulado dia a dia no mês atual.
4. **Ranking de Garçons/Vendedores por Itens:** Atribuição real e comissionamento baseados exclusivamente nos itens lançados por cada garçom.
5. **Top Produtos Vendidos:** Líderes por faturamento e volume, com segregação inteligente entre **Bebidas** e **Cozinha/Pratos**.

---

## 2. Análise de Dados no Banco Legado (`VARANDA672.GDB` / `Dados-database`)

Com base no levantamento minucioso do schema oficial (`schema_varanda.sql`, `tabelas_estrutura.json` e `tabelas_contagem.csv`):

### 2.1. Regra Crítica: Atribuição de Vendas por Garçom via Itens
- **Por que NÃO usar o cabeçalho (`ABERT_MESA.COD_GARCOM` ou `NOTAS_CAB`):**  
  A abertura da mesa pode ser feita pelo hostess, caixa ou por um primeiro garçom (`ABERT_MESA.COD_GARCOM`). Porém, ao longo do atendimento, múltiplos garçons lançam itens na mesma mesa. O Restaurante Varandas comissiona individualmente por item lançado.
- **Tabela Fonte Primária de Lançamentos de Itens:** `LANC_MESA` (200.731 registros).
  - `COD_LANC` (PK): Identificador do lançamento.
  - `COD_GARCOM`: FK do atendente que fez o lançamento do item!
  - `COD_PRODUTO`: Código do item (`ITENS.COD_ITEM`).
  - `QTD`, `PRECO_UNIT`, `DESCONTO_VLR`, `PRECO_CUSTO`.
  - `DATAHORAMOV`: Timestamp exato do lançamento do item.
- **Tabela Fonte de Itens Fechados e Comissões Consolidadas:** `MESAS_COMISSOES` (160.829 registros).
  - `NR_NOTA`, `SERIE`, `DATA_EMISSAO`.
  - `COD_GARCOM`: Garçom responsável pelo item.
  - `COD_ITEM`: Item vendido.
  - `QTD`, `PRECO`, `COMISSAO`.
- **Tabelas de Cadastro de Garçons e Pessoas:**
  - `GARCOM`: `COD_GARCOM` (PK lógica), `COD_PESSOA`, `COD_EMPRESA`, `ATIVO`, `COM_GERAL`, `TURNO`.
  - `PESSOAS`: `COD_PESSOA`, `NOME`, `FANTASIA`.
  - Vínculo: `LANC_MESA.COD_GARCOM -> GARCOM.COD_GARCOM -> PESSOAS.COD_PESSOA (NOME)`.

### 2.2. Categorização de Produtos: Bebidas vs. Cozinha/Pratos
- **Tabela de Itens:** `ITENS` (963 produtos cadastrados).
  - `COD_ITEM`, `DESCRICAO`, `COD_ESTRUTURA`, `CUSTO_MEDIO`, `PRECO_VENDA`.
- **Tabela de Estrutura Mercadológica:** `ESTRUTURA` (55 categorias cadastradas).
  - `COD_ESTRUTURA`, `DESCRICAO`, `COD_IMPRESSAO` (roteamento para impressora do bar ou cozinha), `CARTA_VINHO`.
  - Classificação de **Bebidas**: Categorias que contenham termos como `'BEBIDA'`, `'CERVEJA'`, `'CHOPP'`, `'VINHO'`, `'REFRIGERANTE'`, `'SUCO'`, `'DRINK'`, `'BAR'`, ou com flag `CARTA_VINHO = 'S'`.
  - Classificação de **Cozinha/Pratos**: Demais categorias (Entradas, Petiscos, Carnes, Peixes, Massas, Guarnições, Sobremesas).

---

## 3. Queries SQL Oficiais (Dialeto Firebird 2.5)

### 3.1. Query 1: Ranking de Vendas por Garçom via Itens (Regra dos Itens)
```sql
SELECT 
    G.COD_GARCOM AS id_garcom,
    COALESCE(P.NOME, P.FANTASIA, 'Garçom ' || G.COD_GARCOM) AS nome_garcom,
    COUNT(LM.COD_LANC) AS total_pedidos_itens,
    SUM(LM.QTD * LM.PRECO_UNIT - COALESCE(LM.DESCONTO_VLR, 0)) AS total_faturado,
    SUM(COALESCE(LM.QTD * LM.PRECO_UNIT * (COALESCE(G.COM_GERAL, 10.0) / 100.0), 0)) AS comissao_estimada
FROM LANC_MESA LM
JOIN GARCOM G 
  ON G.COD_GARCOM = LM.COD_GARCOM
LEFT JOIN PESSOAS P 
  ON P.COD_PESSOA = G.COD_PESSOA
WHERE CAST(LM.DATAHORAMOV AS DATE) = :DATA_CONSULTA
  AND LM.COD_EMPRESA = :COD_EMPRESA
GROUP BY G.COD_GARCOM, P.NOME, P.FANTASIA, G.COM_GERAL
ORDER BY total_faturado DESC;
```

*Alternativa para cupons fiscais fechados via `MESAS_COMISSOES`:*
```sql
SELECT 
    MC.COD_GARCOM AS id_garcom,
    COALESCE(P.NOME, P.FANTASIA, 'Garçom ' || MC.COD_GARCOM) AS nome_garcom,
    COUNT(MC.ITEM) AS total_itens,
    SUM(MC.QTD * MC.PRECO) AS total_faturado,
    SUM(COALESCE(MC.COMISSAO, 0)) AS total_comissao
FROM MESAS_COMISSOES MC
JOIN GARCOM G 
  ON G.COD_GARCOM = MC.COD_GARCOM
LEFT JOIN PESSOAS P 
  ON P.COD_PESSOA = G.COD_PESSOA
WHERE MC.DATA_EMISSAO = :DATA_CONSULTA
  AND MC.COD_EMPRESA = :COD_EMPRESA
GROUP BY MC.COD_GARCOM, P.NOME, P.FANTASIA
ORDER BY total_faturado DESC;
```

---

### 3.2. Query 2: Benchmarking Histórico das Últimas 8 Semanas (Mesmo Dia da Semana)
```sql
SELECT 
    COALESCE(AVG(FAT_DIA), 0) AS media_historica_8_semanas,
    COUNT(DISTINCT DATA_REF) AS total_semanas_com_movimento
FROM (
    SELECT 
        CAST(N.DATA_HORA_VENDA AS DATE) AS DATA_REF,
        SUM(COALESCE(F.VALOR, F.VALOR_PAGO, 0)) AS FAT_DIA
    FROM NOTAS_CAB N
    JOIN FORMAS_NOTAS F
      ON F.COD_EMPRESA = N.COD_EMPRESA
     AND F.COD_TIPO_OPERACAO = N.COD_TIPO_OPERACAO
     AND F.NR_NOTA = N.NR_NOTA
     AND F.SERIE = N.SERIE
     AND F.COD_PESSOA = N.COD_PESSOA
     AND F.DATA_EMISSAO = N.DATA_EMISSAO
    WHERE CAST(N.DATA_HORA_VENDA AS DATE) IN (
        DATEADD(-7 DAY TO :DATA_HOJE),
        DATEADD(-14 DAY TO :DATA_HOJE),
        DATEADD(-21 DAY TO :DATA_HOJE),
        DATEADD(-28 DAY TO :DATA_HOJE),
        DATEADD(-35 DAY TO :DATA_HOJE),
        DATEADD(-42 DAY TO :DATA_HOJE),
        DATEADD(-49 DAY TO :DATA_HOJE),
        DATEADD(-56 DAY TO :DATA_HOJE)
    )
    AND N.COD_EMPRESA = :COD_EMPRESA
    AND N.DATA_CANC IS NULL
    AND N.DATA_CANCELA_NFE IS NULL
    GROUP BY CAST(N.DATA_HORA_VENDA AS DATE)
);
```

---

### 3.3. Query 3: Top Produtos Vendidos com Separação Bebidas vs. Cozinha
```sql
SELECT 
    I.COD_ITEM AS id_produto,
    I.DESCRICAO AS nome_produto,
    COALESCE(E.DESCRICAO, 'Diversos') AS categoria,
    CASE 
        WHEN UPPER(COALESCE(E.DESCRICAO, '')) CONTAINING 'BEBIDA'
          OR UPPER(COALESCE(E.DESCRICAO, '')) CONTAINING 'CERVEJA'
          OR UPPER(COALESCE(E.DESCRICAO, '')) CONTAINING 'CHOPP'
          OR UPPER(COALESCE(E.DESCRICAO, '')) CONTAINING 'VINHO'
          OR UPPER(COALESCE(E.DESCRICAO, '')) CONTAINING 'REFRIGERANTE'
          OR UPPER(COALESCE(E.DESCRICAO, '')) CONTAINING 'SUCO'
          OR UPPER(COALESCE(E.DESCRICAO, '')) CONTAINING 'DRINK'
          OR UPPER(COALESCE(E.DESCRICAO, '')) CONTAINING 'BAR'
          OR E.CARTA_VINHO = 'S'
          THEN 'BEBIDA'
        ELSE 'COZINHA'
    END AS tipo_categoria,
    SUM(LM.QTD) AS quantidade_total,
    SUM(LM.QTD * LM.PRECO_UNIT - COALESCE(LM.DESCONTO_VLR, 0)) AS receita_total,
    SUM(LM.QTD * COALESCE(LM.PRECO_CUSTO, I.CUSTO_MEDIO, 0)) AS custo_total
FROM LANC_MESA LM
JOIN ITENS I 
  ON I.COD_ITEM = LM.COD_PRODUTO
LEFT JOIN ESTRUTURA E 
  ON E.COD_ESTRUTURA = I.COD_ESTRUTURA
WHERE CAST(LM.DATAHORAMOV AS DATE) = :DATA_CONSULTA
  AND LM.COD_EMPRESA = :COD_EMPRESA
GROUP BY I.COD_ITEM, I.DESCRICAO, E.DESCRICAO, E.CARTA_VINHO
ORDER BY receita_total DESC;
```

---

### 3.4. Query 4: Faturamento Diário, Lucro Bruto Estimado e Ticket Médio
```sql
SELECT 
    SUM(LM.QTD * LM.PRECO_UNIT - COALESCE(LM.DESCONTO_VLR, 0)) AS faturamento_bruto_dia,
    SUM(LM.QTD * COALESCE(LM.PRECO_CUSTO, 0)) AS custo_total_dia,
    SUM(LM.QTD * LM.PRECO_UNIT - COALESCE(LM.DESCONTO_VLR, 0)) - SUM(LM.QTD * COALESCE(LM.PRECO_CUSTO, 0)) AS lucro_bruto_estimado,
    COUNT(DISTINCT LM.COD_MESA || '-' || LM.COD_ABERTURA) AS total_mesas_atendidas,
    CASE 
        WHEN COUNT(DISTINCT LM.COD_MESA || '-' || LM.COD_ABERTURA) > 0 
        THEN SUM(LM.QTD * LM.PRECO_UNIT - COALESCE(LM.DESCONTO_VLR, 0)) / COUNT(DISTINCT LM.COD_MESA || '-' || LM.COD_ABERTURA)
        ELSE 0 
    END AS ticket_medio_dia
FROM LANC_MESA LM
WHERE CAST(LM.DATAHORAMOV AS DATE) = :DATA_CONSULTA
  AND LM.COD_EMPRESA = :COD_EMPRESA;
```

---

### 3.5. Query 5: Evolução Diária no Mês Atual
```sql
SELECT 
    EXTRACT(DAY FROM N.DATA_HORA_VENDA) AS dia,
    CAST(N.DATA_HORA_VENDA AS DATE) AS data_civil,
    SUM(COALESCE(F.VALOR, F.VALOR_PAGO, 0)) AS faturamento_dia,
    COUNT(DISTINCT N.NR_NOTA || '-' || N.SERIE) AS total_cupons
FROM NOTAS_CAB N
JOIN FORMAS_NOTAS F
  ON F.COD_EMPRESA = N.COD_EMPRESA
 AND F.COD_TIPO_OPERACAO = N.COD_TIPO_OPERACAO
 AND F.NR_NOTA = N.NR_NOTA
 AND F.SERIE = N.SERIE
 AND F.COD_PESSOA = N.COD_PESSOA
 AND F.DATA_EMISSAO = N.DATA_EMISSAO
WHERE N.DATA_HORA_VENDA >= :PRIMEIRO_DIA_MES
  AND N.DATA_HORA_VENDA < :DATA_AMANHA
  AND N.COD_EMPRESA = :COD_EMPRESA
  AND N.DATA_CANC IS NULL
  AND N.DATA_CANCELA_NFE IS NULL
GROUP BY EXTRACT(DAY FROM N.DATA_HORA_VENDA), CAST(N.DATA_HORA_VENDA AS DATE)
ORDER BY data_civil;
```

---

## 4. Arquitetura de Integração e Modelagem no Backend

Para garantir carregamento instantâneo no mobile (latência < 150ms no 4G/5G), propomos a seguinte estratégia de dados:

### 4.1. Opções de Arquitetura de Dados

- **Estratégia Recomendada (Ingestão Relacional via Sync/Worker):**
  1. Estender o sync do agente/worker para persistir os itens vendidos em uma tabela filha no PostgreSQL: `vendas_pdv_itens`:
     - `id`: UUID (PK)
     - `vendaPdvId`: FK -> `vendas_pdv(id)`
     - `idExternoItem`: String
     - `garcomId`: Int / String (ID do garçom no PDV)
     - `garcomNome`: String
     - `produtoId`: Int
     - `descricao`: String
     - `categoria`: String
     - `tipoCategoria`: Enum (`bebida` | `cozinha`)
     - `quantidade`: Decimal(12,4)
     - `precoUnitario`: Decimal(14,2)
     - `precoCusto`: Decimal(14,2)
     - `valorTotal`: Decimal(14,2)
     - `dataHora`: DateTime @db.Timestamptz(3)
  2. O backend Postgres calcula as agregações em índices compostos `(dataHora, tipoCategoria)` e `(dataHora, garcomId)`.

- **Estratégia Alternativa Rápida (Consolidação Agregada de BI):**
  - O sync envia uma carga consolidada das métricas operacionais diárias em cache/tabela de BI no Postgres (`metricas_diarias_bi`), permitindo consumo imediato sem reprocessar milhões de linhas a cada requisição.

---

## 5. Contrato de API (`packages/contracts`)

### 5.1. Endpoint
`GET /api/v1/dashboard/executivo-mobile`

### 5.2. Query Parameters
- `data`: string (`YYYY-MM-DD`, opcional, default: data civil de hoje em `America/Sao_Paulo`).

### 5.3. Schema Zod de Resposta (`dashboardMobileResumoSchema`)
```typescript
import { z } from 'zod';

export const garcomRankingSchema = z.object({
  posicao: z.number().int().positive(),
  idGarcom: z.number().int(),
  nomeGarcom: z.string(),
  totalItens: z.number().int().nonnegative(),
  totalFaturado: z.number().nonnegative(),
  comissaoEstimada: z.number().nonnegative(),
  percentualDoTotal: z.number().min(0).max(100),
});

export const produtoRankingSchema = z.object({
  posicao: z.number().int().positive(),
  idProduto: z.number().int(),
  nome: z.string(),
  categoria: z.string(),
  tipoCategoria: z.enum(['BEBIDA', 'COZINHA']),
  quantidade: z.number().nonnegative(),
  receitaTotal: z.number().nonnegative(),
  custoTotal: z.number().nonnegative(),
  margemLucroPercentual: z.number(),
});

export const evolucaoDiariaSchema = z.object({
  dia: z.number().int(),
  data: z.string(), // YYYY-MM-DD
  faturamento: z.number().nonnegative(),
  pedidos: z.number().int().nonnegative(),
});

export const dashboardMobileResumoSchema = z.object({
  dataReferencia: z.string(),
  diaDaSemanaTexto: z.string(), // ex: "Quinta-feira"
  kpis: z.object({
    faturamentoBruto: z.number().nonnegative(),
    lucroBrutoEstimado: z.number(),
    margemBrutaPercentual: z.number(),
    ticketMedio: z.number().nonnegative(),
    totalPedidos: z.number().int().nonnegative(),
    benchmarking: z.object({
      mediaHistorica8Semanas: z.number().nonnegative(),
      diferencaPercentual: z.number(), // ex: +15.4% ou -3.2%
      desempenhoStatus: z.enum(['acima', 'abaixo', 'estavel']),
      metaDoDia: z.number().nonnegative(),
      percentualAtingidoMeta: z.number().min(0),
    }),
  }),
  evolucaoMes: z.array(evolucaoDiariaSchema),
  rankingGarcons: z.array(garcomRankingSchema),
  rankingProdutos: z.object({
    todos: z.array(produtoRankingSchema),
    bebidas: z.array(produtoRankingSchema),
    cozinha: z.array(produtoRankingSchema),
  }),
  atualizadoEm: z.string().datetime(),
});

export type DashboardMobileResumo = z.infer<typeof dashboardMobileResumoSchema>;
```

---

## 6. Próximos Passos de Backend
1. Validação da estratégia de persistência (tabela `vendas_pdv_itens` no Prisma vs agregação direta).
2. Adição do DTO e Schema em `packages/contracts`.
3. Implementação do método `obterResumoMobile(data: string)` em `apps/api/src/modules/dashboard`.
4. Rota autenticada `GET /api/v1/dashboard/executivo-mobile` liberada para administradores e operadores.
