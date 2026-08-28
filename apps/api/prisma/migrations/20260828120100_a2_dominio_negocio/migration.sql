-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'voucher');

-- CreateEnum
CREATE TYPE "TipoTransacao" AS ENUM ('credito', 'debito');

-- CreateEnum
CREATE TYPE "StatusConciliacao" AS ENUM ('pendente', 'conciliado', 'divergente', 'ignorado');

-- CreateEnum
CREATE TYPE "TipoConciliacao" AS ENUM ('automatica', 'manual');

-- CreateEnum
CREATE TYPE "StatusContaPagar" AS ENUM ('pendente', 'pago', 'cancelado');

-- CreateEnum
CREATE TYPE "StatusReceber" AS ENUM ('pendente', 'recebido', 'divergente');

-- CreateEnum
CREATE TYPE "TipoMovCaixa" AS ENUM ('suprimento', 'sangria', 'despesa_caixa');

-- CreateEnum
CREATE TYPE "OrigemRecurso" AS ENUM ('conta_bancaria', 'caixa_local');

-- CreateEnum
CREATE TYPE "StatusSync" AS ENUM ('sucesso', 'erro', 'parcial');

-- CreateEnum
CREATE TYPE "ContextoArquivo" AS ENUM ('extrato', 'comprovante', 'backup');

-- CreateEnum
CREATE TYPE "StatusArquivo" AS ENUM ('pendente', 'confirmado');

-- CreateTable
CREATE TABLE "arquivos" (
    "id" TEXT NOT NULL,
    "chave_arquivo" TEXT NOT NULL,
    "nome_original" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "tamanho_bytes" INTEGER NOT NULL,
    "contexto" "ContextoArquivo" NOT NULL,
    "status" "StatusArquivo" NOT NULL DEFAULT 'pendente',
    "usuario_id" TEXT,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arquivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendas_pdv" (
    "id" TEXT NOT NULL,
    "id_externo_pdv" TEXT NOT NULL,
    "numero_cupom" TEXT NOT NULL,
    "data_hora" TIMESTAMPTZ(3) NOT NULL,
    "valor_bruto" DECIMAL(14,2) NOT NULL,
    "valor_desconto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valor_liquido" DECIMAL(14,2) NOT NULL,
    "forma_pagamento" "FormaPagamento" NOT NULL,
    "bandeira" TEXT,
    "status_conciliacao" "StatusConciliacao" NOT NULL DEFAULT 'pendente',
    "metadata" JSONB,
    "sincronizado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendas_pdv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extratos_bancarios" (
    "id" TEXT NOT NULL,
    "banco" TEXT NOT NULL,
    "conta" TEXT NOT NULL,
    "data_transacao" DATE NOT NULL,
    "descricao_origem" TEXT NOT NULL,
    "documento" TEXT,
    "tipo_transacao" "TipoTransacao" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "categoria" TEXT,
    "status_conciliacao" "StatusConciliacao" NOT NULL DEFAULT 'pendente',
    "motivo_ignorado" TEXT,
    "hash_duplicidade" TEXT NOT NULL,
    "arquivo_id" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extratos_bancarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conciliacoes" (
    "id" TEXT NOT NULL,
    "data_conciliacao" DATE NOT NULL,
    "valor_extrato" DECIMAL(14,2) NOT NULL,
    "valor_pdv" DECIMAL(14,2) NOT NULL,
    "valor_taxa_gateway" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "diferenca_ajuste" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tipo_conciliacao" "TipoConciliacao" NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "observacao" TEXT,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conciliacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conciliacao_extratos" (
    "conciliacao_id" TEXT NOT NULL,
    "extrato_id" TEXT NOT NULL,

    CONSTRAINT "conciliacao_extratos_pkey" PRIMARY KEY ("conciliacao_id","extrato_id")
);

-- CreateTable
CREATE TABLE "conciliacao_itens_venda" (
    "conciliacao_id" TEXT NOT NULL,
    "venda_pdv_id" TEXT NOT NULL,

    CONSTRAINT "conciliacao_itens_venda_pkey" PRIMARY KEY ("conciliacao_id","venda_pdv_id")
);

-- CreateTable
CREATE TABLE "contas_pagar" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "fornecedor" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "data_vencimento" DATE NOT NULL,
    "data_pagamento" DATE,
    "forma_pagamento" "FormaPagamento",
    "origem_recurso" "OrigemRecurso",
    "comprovante_arquivo_id" TEXT,
    "status" "StatusContaPagar" NOT NULL DEFAULT 'pendente',
    "observacao" TEXT,
    "criado_por_id" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contas_pagar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_receber" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "origem_descricao" TEXT NOT NULL,
    "meio_pagamento" "FormaPagamento" NOT NULL,
    "valor_bruto" DECIMAL(14,2) NOT NULL,
    "valor_taxa_estimada" DECIMAL(14,2) NOT NULL,
    "valor_liquido_previsto" DECIMAL(14,2) NOT NULL,
    "data_previsao" DATE NOT NULL,
    "data_recebimento" DATE,
    "conciliacao_id" TEXT,
    "status" "StatusReceber" NOT NULL DEFAULT 'pendente',

    CONSTRAINT "contas_receber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes_caixa" (
    "id" TEXT NOT NULL,
    "data_hora" TIMESTAMPTZ(3) NOT NULL,
    "tipo" "TipoMovCaixa" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "categoria" TEXT,
    "responsavel" TEXT NOT NULL,
    "comprovante_arquivo_id" TEXT,
    "usuario_id" TEXT NOT NULL,
    "conta_pagar_id" TEXT,
    "venda_pdv_id" TEXT,

    CONSTRAINT "movimentacoes_caixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fechamentos_mensais" (
    "id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "faturamento_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "despesas_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "saldo_final" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "trancado" BOOLEAN NOT NULL DEFAULT false,
    "trancado_por_id" TEXT,
    "trancado_em" TIMESTAMPTZ(3),
    "justificativa_destrave" TEXT,

    CONSTRAINT "fechamentos_mensais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxas_gateway" (
    "id" TEXT NOT NULL,
    "meio_pagamento" "FormaPagamento" NOT NULL,
    "bandeira" TEXT,
    "percentual" DECIMAL(5,2) NOT NULL,
    "dias_liquidacao" INTEGER NOT NULL,
    "antecipacao_automatica" BOOLEAN NOT NULL DEFAULT false,
    "vigencia_inicio" DATE NOT NULL,
    "vigencia_fim" DATE,

    CONSTRAINT "taxas_gateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agente_sync_logs" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "tipo_evento" TEXT NOT NULL,
    "registros_recebidos" INTEGER NOT NULL DEFAULT 0,
    "registros_criados" INTEGER NOT NULL DEFAULT 0,
    "registros_atualizados" INTEGER NOT NULL DEFAULT 0,
    "status" "StatusSync" NOT NULL,
    "erro_detalhe" TEXT,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agente_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agente_heartbeats" (
    "id" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versao_agente" TEXT NOT NULL,
    "metricas" JSONB,

    CONSTRAINT "agente_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backups_pdv_local" (
    "id" TEXT NOT NULL,
    "arquivo_id" TEXT NOT NULL,
    "data_referencia" DATE NOT NULL,
    "tamanho_bytes" INTEGER NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "versao_banco_origem" TEXT,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backups_pdv_local_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arquivos_chave_arquivo_key" ON "arquivos"("chave_arquivo");

-- CreateIndex
CREATE INDEX "arquivos_usuario_id_idx" ON "arquivos"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendas_pdv_id_externo_pdv_key" ON "vendas_pdv"("id_externo_pdv");

-- CreateIndex
CREATE INDEX "vendas_pdv_data_hora_status_conciliacao_idx" ON "vendas_pdv"("data_hora", "status_conciliacao");

-- CreateIndex
CREATE UNIQUE INDEX "extratos_bancarios_hash_duplicidade_key" ON "extratos_bancarios"("hash_duplicidade");

-- CreateIndex
CREATE INDEX "extratos_bancarios_data_transacao_status_conciliacao_idx" ON "extratos_bancarios"("data_transacao", "status_conciliacao");

-- CreateIndex
CREATE INDEX "extratos_bancarios_arquivo_id_idx" ON "extratos_bancarios"("arquivo_id");

-- CreateIndex
CREATE INDEX "conciliacao_extratos_extrato_id_idx" ON "conciliacao_extratos"("extrato_id");

-- CreateIndex
CREATE INDEX "conciliacao_itens_venda_venda_pdv_id_idx" ON "conciliacao_itens_venda"("venda_pdv_id");

-- CreateIndex
CREATE UNIQUE INDEX "contas_pagar_codigo_key" ON "contas_pagar"("codigo");

-- CreateIndex
CREATE INDEX "contas_pagar_status_data_vencimento_idx" ON "contas_pagar"("status", "data_vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "contas_receber_codigo_key" ON "contas_receber"("codigo");

-- CreateIndex
CREATE INDEX "contas_receber_data_previsao_status_idx" ON "contas_receber"("data_previsao", "status");

-- CreateIndex
CREATE INDEX "contas_receber_conciliacao_id_idx" ON "contas_receber"("conciliacao_id");

-- CreateIndex
CREATE INDEX "movimentacoes_caixa_data_hora_idx" ON "movimentacoes_caixa"("data_hora");

-- CreateIndex
CREATE INDEX "movimentacoes_caixa_conta_pagar_id_idx" ON "movimentacoes_caixa"("conta_pagar_id");

-- CreateIndex
CREATE UNIQUE INDEX "fechamentos_mensais_ano_mes_key" ON "fechamentos_mensais"("ano", "mes");

-- CreateIndex
CREATE INDEX "taxas_gateway_meio_pagamento_bandeira_vigencia_inicio_idx" ON "taxas_gateway"("meio_pagamento", "bandeira", "vigencia_inicio");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_nome_key" ON "categorias"("nome");

-- CreateIndex
CREATE INDEX "agente_sync_logs_lote_id_idx" ON "agente_sync_logs"("lote_id");

-- CreateIndex
CREATE INDEX "agente_heartbeats_criado_em_idx" ON "agente_heartbeats"("criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "backups_pdv_local_arquivo_id_key" ON "backups_pdv_local"("arquivo_id");

-- AddForeignKey
ALTER TABLE "arquivos" ADD CONSTRAINT "arquivos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extratos_bancarios" ADD CONSTRAINT "extratos_bancarios_arquivo_id_fkey" FOREIGN KEY ("arquivo_id") REFERENCES "arquivos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacoes" ADD CONSTRAINT "conciliacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacao_extratos" ADD CONSTRAINT "conciliacao_extratos_conciliacao_id_fkey" FOREIGN KEY ("conciliacao_id") REFERENCES "conciliacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacao_extratos" ADD CONSTRAINT "conciliacao_extratos_extrato_id_fkey" FOREIGN KEY ("extrato_id") REFERENCES "extratos_bancarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacao_itens_venda" ADD CONSTRAINT "conciliacao_itens_venda_conciliacao_id_fkey" FOREIGN KEY ("conciliacao_id") REFERENCES "conciliacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliacao_itens_venda" ADD CONSTRAINT "conciliacao_itens_venda_venda_pdv_id_fkey" FOREIGN KEY ("venda_pdv_id") REFERENCES "vendas_pdv"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_pagar" ADD CONSTRAINT "contas_pagar_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_receber" ADD CONSTRAINT "contas_receber_conciliacao_id_fkey" FOREIGN KEY ("conciliacao_id") REFERENCES "conciliacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_caixa" ADD CONSTRAINT "movimentacoes_caixa_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_caixa" ADD CONSTRAINT "movimentacoes_caixa_conta_pagar_id_fkey" FOREIGN KEY ("conta_pagar_id") REFERENCES "contas_pagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_caixa" ADD CONSTRAINT "movimentacoes_caixa_venda_pdv_id_fkey" FOREIGN KEY ("venda_pdv_id") REFERENCES "vendas_pdv"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fechamentos_mensais" ADD CONSTRAINT "fechamentos_mensais_trancado_por_id_fkey" FOREIGN KEY ("trancado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backups_pdv_local" ADD CONSTRAINT "backups_pdv_local_arquivo_id_fkey" FOREIGN KEY ("arquivo_id") REFERENCES "arquivos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
