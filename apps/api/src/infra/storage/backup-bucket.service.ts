import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { AppException } from '../../common/exceptions/app.exception';

export interface ParteConcluida {
  numero: number;
  etag: string;
}

/** Bucket privado dedicado aos envelopes de backup. O cliente recebe apenas
 * uma URL curta para uma parte específica; nunca recebe as credenciais S3. */
@Injectable()
export class BackupBucketService {
  private client?: S3Client;

  private configuracao(): { client: S3Client; bucket: string } {
    const bucket = process.env.BUCKET;
    const endpoint = process.env.ENDPOINT;
    const region = process.env.REGION;
    const accessKeyId = process.env.ACCESS_KEY_ID;
    const secretAccessKey = process.env.SECRET_ACCESS_KEY;
    if (!bucket || !endpoint || !region || !accessKeyId || !secretAccessKey) {
      throw new AppException({
        status: 503,
        code: 'STORAGE_UNAVAILABLE',
        message: 'Bucket privado de backups não está configurado.',
      });
    }
    this.client ??= new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    });
    return { client: this.client, bucket };
  }

  async iniciar(chave: string): Promise<string> {
    const { client, bucket } = this.configuracao();
    const result = await client.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: chave,
        ContentType: 'application/vnd.picos-varandas.encrypted-backup',
        Metadata: { envelope: 'PVAENC01' },
      }),
    );
    if (!result.UploadId) throw new Error('Bucket não retornou o identificador multipart.');
    return result.UploadId;
  }

  async urlDaParte(
    chave: string,
    multipartId: string,
    numeroParte: number,
    _sha256Hex: string,
  ): Promise<string> {
    const { client, bucket } = this.configuracao();
    return getSignedUrl(
      client,
      new UploadPartCommand({
        Bucket: bucket,
        Key: chave,
        UploadId: multipartId,
        PartNumber: numeroParte,
      }),
      { expiresIn: 15 * 60 },
    );
  }

  async concluir(chave: string, multipartId: string, partes: ParteConcluida[]): Promise<void> {
    const { client, bucket } = this.configuracao();
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: chave,
        UploadId: multipartId,
        MultipartUpload: {
          Parts: partes.map((parte) => ({ ETag: parte.etag, PartNumber: parte.numero })),
        },
      }),
    );
  }

  async abortar(chave: string, multipartId: string): Promise<void> {
    const { client, bucket } = this.configuracao();
    await client.send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: chave, UploadId: multipartId }),
    );
  }

  async tamanho(chave: string): Promise<number> {
    const { client, bucket } = this.configuracao();
    const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: chave }));
    if (result.ContentLength === undefined) throw new Error('Bucket não informou o tamanho.');
    return result.ContentLength;
  }

  async abrir(chave: string): Promise<Readable> {
    const { client, bucket } = this.configuracao();
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: chave }));
    if (!result.Body || !('pipe' in result.Body)) throw new Error('Bucket não retornou um stream.');
    return result.Body as Readable;
  }
}
