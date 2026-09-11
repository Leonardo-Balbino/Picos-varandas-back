# Deploy do transporte de backups no Railway

O transporte usa dois serviços construídos pelo mesmo `Dockerfile`:

- **API**: comando padrão `node dist/main.js`; autentica o agente, cria o
  multipart e emite URLs pré-assinadas;
- **worker-backups**: comando `node dist/worker-main.js`; baixa o envelope do
  bucket e o valida. Ele não expõe porta e não recebe tráfego público.

Ambos usam o mesmo Postgres e o mesmo bucket privado. O arquivo grande vai do
agente direto ao bucket; ele não atravessa a memória da API e não depende do
volume local de nenhum serviço.

Não é necessário entrar por SSH, instalar S3, criar pasta ou alterar o sistema
operacional de uma VPS. Neste projeto, o bucket e o worker são recursos dentro
do próprio Railway. A configuração é feita no painel do projeto.

## Passo a passo no painel para quem está começando

1. Abra o mesmo projeto Railway em que está o `picos-varandas-back`.
2. No canvas do projeto, clique em **Create** ou **+ New**.
3. Escolha **Bucket**.
4. Dê o nome `backups-varandas` e escolha, de preferência, a mesma região da
   API. A região do bucket não pode ser trocada depois.
5. Aguarde o bucket ficar ativo. Ele deve continuar privado; não há opção de
   domínio público para configurar.
6. Abra o serviço atual da API e vá à aba **Variables**.
7. Use a opção de adicionar variáveis/referências do bucket. Injete estas cinco
   referências: `BUCKET`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION` e
   `ENDPOINT`. Use `BUCKET`, não `RAILWAY_BUCKET_NAME`.
8. Ainda na API, crie `AGENT_HMAC_SECRETS_JSON` com o formato mostrado abaixo.
9. Volte ao canvas, clique em **+ New → GitHub Repo** e selecione o mesmo
   repositório do backend. Renomeie o novo serviço para `worker-backups`.
10. Em **worker-backups → Settings → Deploy**, coloque o Start Command
    `node dist/worker-main.js`.
11. Não gere domínio público para o worker.
12. Em **Variables** do worker, referencie o mesmo `DATABASE_URL` do Postgres e
    as mesmas cinco variáveis do bucket.
13. Crie no worker a variável `BACKUP_PRIVATE_KEY_BASE64` usando o arquivo
    entregue separadamente. Marque-a como variável selada depois de salvar.
14. Faça primeiro o deploy da API e depois o do worker. Confira os logs do
    worker; ele deve iniciar e aguardar backups, sem erro de variável ausente.

Não é necessário configurar CORS no bucket, porque o upload parte do agente
Python, e não de um navegador.

## Variáveis da API

```env
DATABASE_URL=...
AGENT_HMAC_SECRETS_JSON={"1763829734":"segredo-aleatorio-com-pelo-menos-32-bytes"}
BUCKET=<reference do bucket>
ACCESS_KEY_ID=<reference do bucket>
SECRET_ACCESS_KEY=<reference do bucket>
REGION=<reference do bucket>
ENDPOINT=<reference do bucket>
```

O segredo HMAC deve ser exatamente o mesmo protegido por DPAPI no servidor do
cliente. `AGENT_HMAC_SECRET` continua aceito apenas para migração de uma única
instalação.

## Variáveis do worker

Configure `DATABASE_URL` e as cinco variáveis do bucket acima. Adicione:

```env
BACKUP_PRIVATE_KEY_BASE64=<PEM PKCS#8 completo codificado em Base64>
BACKUP_WORKER_INTERVAL_MS=30000
BACKUP_WORKER_STALE_MINUTES=180
```

A chave privada existe somente no worker. A API e o agente recebem apenas a
chave pública. Não grave nenhuma das chaves no Git, nos logs ou em volume
compartilhado.

## Ordem do primeiro deploy

1. Gere RSA 4096 e guarde a chave privada como variável secreta do worker.
2. Crie um Storage Bucket privado e referencie suas cinco variáveis nos dois
   serviços.
3. Aplique a migration com o Pre-Deploy Command já usado pelo projeto:
   `./node_modules/.bin/prisma migrate deploy --config apps/api/prisma.config.ts`.
4. Publique a API e confira `/api/v1/health/live`.
5. Crie o serviço worker a partir do mesmo repositório/imagem e substitua o
   Start Command por `node dist/worker-main.js`.
6. Cadastre o HMAC do agente na API e instale a chave pública no Windows.
7. Execute `test-backend` e depois `run-once` com uma cópia de homologação.

O estado esperado passa por `enviando → recebido → processando → validado`.
Somente `validado` vira `accepted` para o agente. Falha criptográfica vai para
`quarentena` e mantém o `.pva` local para diagnóstico e nova tentativa segura.

## Limite desta entrega

O worker autentica e compara integralmente o conteúdo original em streaming,
mas ainda não extrai RAR/ZIP nem abre o Firebird. Essa etapa depende de uma
amostra real do arquivo produzido pelo ERP, confirmação de senha/multipartes e
validação do Firebird em um container isolado. O arquivo original no servidor
do cliente continua intacto durante todo o fluxo.
