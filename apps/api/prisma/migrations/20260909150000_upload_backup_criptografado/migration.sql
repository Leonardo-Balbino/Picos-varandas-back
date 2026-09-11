CREATE TYPE "StatusUploadBackup" AS ENUM (
  'enviando',
  'recebido',
  'processando',
  'validado',
  'falhou',
  'quarentena',
  'expirado'
);

CREATE TABLE "uploads_backup_pdv" (
  "id" TEXT NOT NULL,
  "agente_id" TEXT NOT NULL,
  "chave_idempotencia" TEXT NOT NULL,
  "nome_origem" TEXT NOT NULL,
  "tamanho_origem" BIGINT NOT NULL,
  "sha256_origem" TEXT NOT NULL,
  "mtime_origem_ns" TEXT NOT NULL,
  "formato_envelope" TEXT NOT NULL,
  "tamanho_envelope" BIGINT NOT NULL,
  "sha256_envelope" TEXT NOT NULL,
  "chave_objeto" TEXT NOT NULL,
  "multipart_upload_id" TEXT,
  "proximo_offset" BIGINT NOT NULL DEFAULT 0,
  "status" "StatusUploadBackup" NOT NULL DEFAULT 'enviando',
  "erro_detalhe" TEXT,
  "tentativas" INTEGER NOT NULL DEFAULT 0,
  "recebido_em" TIMESTAMPTZ(3),
  "validado_em" TIMESTAMPTZ(3),
  "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "uploads_backup_pdv_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partes_upload_backup_pdv" (
  "id" TEXT NOT NULL,
  "upload_id" TEXT NOT NULL,
  "numero_parte" INTEGER NOT NULL,
  "offset_bytes" BIGINT NOT NULL,
  "tamanho_bytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "etag" TEXT NOT NULL,
  "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "partes_upload_backup_pdv_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uploads_backup_pdv_chave_objeto_key" ON "uploads_backup_pdv"("chave_objeto");
CREATE UNIQUE INDEX "uploads_backup_pdv_agente_id_chave_idempotencia_key" ON "uploads_backup_pdv"("agente_id", "chave_idempotencia");
CREATE INDEX "uploads_backup_pdv_status_atualizado_em_idx" ON "uploads_backup_pdv"("status", "atualizado_em");
CREATE INDEX "uploads_backup_pdv_agente_id_criado_em_idx" ON "uploads_backup_pdv"("agente_id", "criado_em");
CREATE UNIQUE INDEX "partes_upload_backup_pdv_upload_id_numero_parte_key" ON "partes_upload_backup_pdv"("upload_id", "numero_parte");
CREATE UNIQUE INDEX "partes_upload_backup_pdv_upload_id_offset_bytes_key" ON "partes_upload_backup_pdv"("upload_id", "offset_bytes");

ALTER TABLE "partes_upload_backup_pdv"
  ADD CONSTRAINT "partes_upload_backup_pdv_upload_id_fkey"
  FOREIGN KEY ("upload_id") REFERENCES "uploads_backup_pdv"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
