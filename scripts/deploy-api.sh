#!/usr/bin/env bash
# Deploy inicial da API no Cloud Run — Card A1.
#
# Pré-requisito: os secrets abaixo já precisam existir no Google Secret
# Manager (varanda-database-url, varanda-direct-url, varanda-jwt-secret).
# A criação desses secrets, a service account dedicada, o pipeline
# automatizado via GitHub Actions e a migração como passo separado de CI são
# objeto do Card A3 — este script é só o comando de deploy manual inicial,
# executado a partir da raiz do repositório (o Dockerfile depende disso).
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?defina GCP_PROJECT_ID}"

gcloud run deploy varanda-api \
  --project "$PROJECT_ID" \
  --source . \
  --region southamerica-east1 \
  --min-instances 0 \
  --max-instances 2 \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 40 \
  --cpu-boost \
  --timeout 300 \
  --allow-unauthenticated \
  --set-secrets DATABASE_URL=varanda-database-url:latest,DIRECT_URL=varanda-direct-url:latest,JWT_SECRET=varanda-jwt-secret:latest
