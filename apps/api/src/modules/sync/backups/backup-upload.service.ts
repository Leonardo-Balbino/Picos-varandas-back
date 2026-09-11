import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  ConfirmarParteUploadBackupInput,
  ConcluirUploadBackupInput,
  IniciarUploadBackupInput,
  PrepararParteUploadBackupInput,
} from 'contracts';
import { Prisma } from '../../../generated/prisma/client';
import { AppException } from '../../../common/exceptions/app.exception';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { BackupBucketService } from '../../../infra/storage/backup-bucket.service';

const MIN_PART_SIZE = 5 * 1024 * 1024;

@Injectable()
export class BackupUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bucket: BackupBucketService,
  ) {}

  async iniciar(agenteId: string, input: IniciarUploadBackupInput) {
    const existente = await this.prisma.uploadBackupPdv.findUnique({
      where: { agenteId_chaveIdempotencia: { agenteId, chaveIdempotencia: input.idempotencyKey } },
    });
    if (existente) {
      this.conferirManifesto(existente, input);
      const partes = await this.prisma.parteUploadBackupPdv.count({ where: { uploadId: existente.id } });
      return this.respostaSessao(existente, partes + 1);
    }

    const agenteHash = createHash('sha256').update(agenteId).digest('hex').slice(0, 24);
    const chaveObjeto = `backups/${agenteHash}/${randomUUID()}.pva`;
    const multipartUploadId = await this.bucket.iniciar(chaveObjeto);
    try {
      const upload = await this.prisma.uploadBackupPdv.create({
        data: {
          agenteId,
          chaveIdempotencia: input.idempotencyKey,
          nomeOrigem: input.source.fileName,
          tamanhoOrigem: BigInt(input.source.size),
          sha256Origem: input.source.sha256,
          mtimeOrigemNs: input.source.modifiedAtNs,
          formatoEnvelope: input.envelope.format,
          tamanhoEnvelope: BigInt(input.envelope.size),
          sha256Envelope: input.envelope.sha256,
          chaveObjeto,
          multipartUploadId,
        },
      });
      return this.respostaSessao(upload, 1);
    } catch (erro) {
      await this.bucket.abortar(chaveObjeto, multipartUploadId).catch(() => undefined);
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        const corrida = await this.prisma.uploadBackupPdv.findUniqueOrThrow({
          where: {
            agenteId_chaveIdempotencia: { agenteId, chaveIdempotencia: input.idempotencyKey },
          },
        });
        this.conferirManifesto(corrida, input);
        const partes = await this.prisma.parteUploadBackupPdv.count({ where: { uploadId: corrida.id } });
        return this.respostaSessao(corrida, partes + 1);
      }
      throw erro;
    }
  }

  async prepararParte(
    agenteId: string,
    uploadId: string,
    input: PrepararParteUploadBackupInput,
  ) {
    const upload = await this.obter(uploadId, agenteId);
    this.exigirEnviando(upload.status);
    if (!upload.multipartUploadId) throw this.conflito('Sessão multipart indisponível.');

    const offset = BigInt(input.offset);
    const final = offset + BigInt(input.size) === upload.tamanhoEnvelope;
    if (offset !== upload.proximoOffset) throw this.conflito('Offset diferente do confirmado.');
    if (offset + BigInt(input.size) > upload.tamanhoEnvelope) {
      throw this.conflito('A parte ultrapassa o tamanho declarado do envelope.');
    }
    if (!final && input.size < MIN_PART_SIZE) {
      throw this.conflito('Partes intermediárias devem ter ao menos 5 MiB.');
    }
    const quantidade = await this.prisma.parteUploadBackupPdv.count({ where: { uploadId } });
    if (input.partNumber !== quantidade + 1) {
      throw this.conflito('Número da parte fora da sequência esperada.');
    }
    const uploadUrl = await this.bucket.urlDaParte(
      upload.chaveObjeto,
      upload.multipartUploadId,
      input.partNumber,
      input.sha256,
    );
    return { uploadUrl, expiresInSeconds: 900 };
  }

  async confirmarParte(
    agenteId: string,
    uploadId: string,
    numeroParte: number,
    input: ConfirmarParteUploadBackupInput,
  ) {
    if (numeroParte !== input.partNumber) throw this.conflito('Número da parte divergente.');
    if (/[^\x20-\x7e]/.test(input.etag)) throw this.conflito('ETag inválido.');
    const upload = await this.obter(uploadId, agenteId);
    this.exigirEnviando(upload.status);
    if (BigInt(input.offset) !== upload.proximoOffset) {
      const existente = await this.prisma.parteUploadBackupPdv.findUnique({
        where: { uploadId_numeroParte: { uploadId, numeroParte } },
      });
      if (
        existente &&
        existente.offsetBytes === BigInt(input.offset) &&
        existente.tamanhoBytes === input.size &&
        existente.sha256 === input.sha256 &&
        existente.etag === input.etag
      ) {
        return { nextOffset: Number(existente.offsetBytes) + existente.tamanhoBytes };
      }
      throw this.conflito('Offset diferente do confirmado.');
    }
    const proximoOffset = upload.proximoOffset + BigInt(input.size);
    if (proximoOffset > upload.tamanhoEnvelope) throw this.conflito('Parte ultrapassa o envelope.');

    await this.prisma.$transaction(async (tx) => {
      await tx.parteUploadBackupPdv.create({
        data: {
          uploadId,
          numeroParte,
          offsetBytes: BigInt(input.offset),
          tamanhoBytes: input.size,
          sha256: input.sha256,
          etag: input.etag,
        },
      });
      const atualizado = await tx.uploadBackupPdv.updateMany({
        where: { id: uploadId, agenteId, status: 'enviando', proximoOffset: upload.proximoOffset },
        data: { proximoOffset },
      });
      if (atualizado.count !== 1) throw this.conflito('A sessão avançou em outra requisição.');
    });
    return { nextOffset: Number(proximoOffset) };
  }

  async concluir(agenteId: string, uploadId: string, input: ConcluirUploadBackupInput) {
    const upload = await this.obter(uploadId, agenteId);
    if (upload.status !== 'enviando') return this.respostaStatus(upload.status);
    if (
      upload.tamanhoEnvelope !== BigInt(input.encryptedSize) ||
      upload.sha256Envelope !== input.encryptedSha256
    ) {
      throw this.conflito('Tamanho ou SHA-256 difere do manifesto inicial.');
    }
    if (upload.proximoOffset !== upload.tamanhoEnvelope || !upload.multipartUploadId) {
      throw this.conflito('O upload ainda não recebeu todas as partes.');
    }
    const partes = await this.prisma.parteUploadBackupPdv.findMany({
      where: { uploadId },
      orderBy: { numeroParte: 'asc' },
    });
    if (partes.length === 0) throw this.conflito('Nenhuma parte foi confirmada.');
    try {
      await this.bucket.concluir(
        upload.chaveObjeto,
        upload.multipartUploadId,
        partes.map((p) => ({ numero: p.numeroParte, etag: p.etag })),
      );
    } catch (erro) {
      // CompleteMultipartUpload pode ter sido efetivado no bucket e a resposta
      // perdida. HeadObject torna a repetição segura nesse intervalo crítico.
      const tamanhoJaConcluido = await this.bucket.tamanho(upload.chaveObjeto).catch(() => -1);
      if (BigInt(tamanhoJaConcluido) !== upload.tamanhoEnvelope) throw erro;
    }
    const tamanhoNoBucket = await this.bucket.tamanho(upload.chaveObjeto);
    if (BigInt(tamanhoNoBucket) !== upload.tamanhoEnvelope) {
      await this.prisma.uploadBackupPdv.update({
        where: { id: uploadId },
        data: { status: 'quarentena', erroDetalhe: 'Tamanho do objeto diverge do manifesto.' },
      });
      throw this.conflito('O bucket confirmou tamanho divergente.');
    }
    await this.prisma.uploadBackupPdv.update({
      where: { id: uploadId },
      data: { status: 'recebido', recebidoEm: new Date(), multipartUploadId: null },
    });
    return { status: 'verifying' as const };
  }

  async status(agenteId: string, uploadId: string) {
    const upload = await this.obter(uploadId, agenteId);
    return this.respostaStatus(upload.status, upload.erroDetalhe);
  }

  private async obter(uploadId: string, agenteId: string) {
    const upload = await this.prisma.uploadBackupPdv.findFirst({ where: { id: uploadId, agenteId } });
    if (!upload) {
      throw new AppException({ status: 404, code: 'NOT_FOUND', message: 'Upload não encontrado.' });
    }
    return upload;
  }

  private conferirManifesto(upload: Awaited<ReturnType<BackupUploadService['obter']>>, input: IniciarUploadBackupInput) {
    if (
      upload.nomeOrigem !== input.source.fileName ||
      upload.tamanhoOrigem !== BigInt(input.source.size) ||
      upload.sha256Origem !== input.source.sha256 ||
      upload.mtimeOrigemNs !== input.source.modifiedAtNs ||
      upload.tamanhoEnvelope !== BigInt(input.envelope.size) ||
      upload.sha256Envelope !== input.envelope.sha256
    ) {
      throw this.conflito('A chave de idempotência já pertence a outro manifesto.');
    }
  }

  private respostaSessao(
    upload: Awaited<ReturnType<BackupUploadService['obter']>>,
    nextPartNumber: number,
  ) {
    return {
      uploadId: upload.id,
      nextOffset: Number(upload.proximoOffset),
      nextPartNumber,
      ...this.respostaStatus(upload.status, upload.erroDetalhe),
    };
  }

  private respostaStatus(status: string, erro?: string | null) {
    if (status === 'validado') return { status: 'accepted' as const };
    if (status === 'recebido' || status === 'processando') return { status: 'verifying' as const };
    if (status === 'falhou' || status === 'quarentena' || status === 'expirado') {
      return { status: 'failed' as const, error: erro ?? 'Falha ao validar o backup.' };
    }
    return { status: 'uploading' as const };
  }

  private exigirEnviando(status: string): void {
    if (status !== 'enviando') throw this.conflito('A sessão não aceita novas partes.');
  }

  private conflito(message: string): AppException {
    return new AppException({ status: 409, code: 'CONFLICT', message });
  }
}
