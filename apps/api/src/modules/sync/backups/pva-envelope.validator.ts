import {
  constants,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
} from 'node:crypto';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

const MAGIC = Buffer.from('PVAENC01', 'ascii');
const TAG_SIZE = 16;
const MAX_HEADER = 64 * 1024;
const MAX_METADATA = 1024 * 1024;

export class EnvelopeValidationError extends Error {}

export interface EnvelopeExpected {
  sourceName: string;
  sourceSize: bigint;
  sourceSha256: string;
}

async function readExact(handle: FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const result = await handle.read({
      buffer,
      offset,
      length: buffer.length - offset,
      position: position + offset,
    });
    if (result.bytesRead === 0) throw new EnvelopeValidationError('Envelope truncado.');
    offset += result.bytesRead;
  }
}

function privateKeyPem(): string {
  const encoded = process.env.BACKUP_PRIVATE_KEY_BASE64;
  if (!encoded) throw new Error('BACKUP_PRIVATE_KEY_BASE64 não configurada no worker.');
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  if (!decoded.includes('PRIVATE KEY')) throw new Error('Chave privada de backup inválida.');
  return decoded;
}

/** Autentica o envelope e calcula o hash do backup original sem gravar o
 * plaintext em disco. Qualquer byte alterado faz decipher.final() falhar. */
export async function validatePvaEnvelope(path: string, expected: EnvelopeExpected): Promise<void> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (stat.size < MAGIC.length + 4 + TAG_SIZE) throw new EnvelopeValidationError('Envelope truncado.');
    const prefix = Buffer.alloc(12);
    await readExact(handle, prefix, 0);
    if (!prefix.subarray(0, 8).equals(MAGIC)) throw new EnvelopeValidationError('Magic PVAENC01 inválido.');
    const headerSize = prefix.readUInt32BE(8);
    if (headerSize < 1 || headerSize > MAX_HEADER) throw new EnvelopeValidationError('Cabeçalho fora do limite.');
    const headerEnd = 12 + headerSize;
    if (headerEnd + TAG_SIZE >= stat.size) throw new EnvelopeValidationError('Envelope sem conteúdo.');
    const headerBytes = Buffer.alloc(headerSize);
    await readExact(handle, headerBytes, 12);
    const headerPrefix = Buffer.concat([prefix, headerBytes]);

    let header: Record<string, unknown>;
    try {
      header = JSON.parse(headerBytes.toString('ascii')) as Record<string, unknown>;
    } catch {
      throw new EnvelopeValidationError('JSON do cabeçalho inválido.');
    }
    if (
      header.version !== 1 ||
      header.algorithm !== 'RSA-OAEP-SHA256+AES-256-GCM' ||
      typeof header.keyFingerprint !== 'string' ||
      typeof header.wrappedKey !== 'string' ||
      typeof header.nonce !== 'string'
    ) {
      throw new EnvelopeValidationError('Parâmetros criptográficos do envelope inválidos.');
    }

    const key = createPrivateKey(privateKeyPem());
    const publicDer = createPublicKey(key).export({ type: 'spki', format: 'der' });
    const fingerprint = createHash('sha256').update(publicDer).digest('hex');
    if (fingerprint !== header.keyFingerprint) {
      throw new EnvelopeValidationError('Envelope destinado a outra chave privada.');
    }
    const wrappedKey = Buffer.from(header.wrappedKey, 'base64');
    const nonce = Buffer.from(header.nonce, 'base64');
    if (nonce.length !== 12) throw new EnvelopeValidationError('Nonce inválido.');
    let aesKey: Buffer;
    try {
      aesKey = privateDecrypt(
        { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
        wrappedKey,
      );
    } catch {
      throw new EnvelopeValidationError('Não foi possível abrir a chave do envelope.');
    }
    if (aesKey.length !== 32) throw new EnvelopeValidationError('Chave AES inválida.');

    const tag = Buffer.alloc(TAG_SIZE);
    await readExact(handle, tag, stat.size - TAG_SIZE);
    const decipher = createDecipheriv('aes-256-gcm', aesKey, nonce);
    decipher.setAAD(headerPrefix);
    decipher.setAuthTag(tag);
    const payloadHash = createHash('sha256');
    let plaintextBytes = 0n;
    let pending = Buffer.alloc(0);
    let metadataSize: number | null = null;
    let metadata: Record<string, unknown> | null = null;

    const consume = (plain: Buffer): void => {
      if (metadata) {
        payloadHash.update(plain);
        plaintextBytes += BigInt(plain.length);
        return;
      }
      pending = Buffer.concat([pending, plain]);
      if (metadataSize === null && pending.length >= 4) {
        metadataSize = pending.readUInt32BE(0);
        if (metadataSize < 2 || metadataSize > MAX_METADATA) {
          throw new EnvelopeValidationError('Metadados internos fora do limite.');
        }
      }
      if (metadataSize !== null && pending.length >= 4 + metadataSize) {
        try {
          metadata = JSON.parse(pending.subarray(4, 4 + metadataSize).toString('utf8')) as Record<string, unknown>;
        } catch {
          throw new EnvelopeValidationError('Metadados internos inválidos.');
        }
        const payload = pending.subarray(4 + metadataSize);
        payloadHash.update(payload);
        plaintextBytes += BigInt(payload.length);
        pending = Buffer.alloc(0);
      }
    };

    const block = Buffer.allocUnsafe(4 * 1024 * 1024);
    let position = headerEnd;
    const cipherEnd = stat.size - TAG_SIZE;
    try {
      while (position < cipherEnd) {
        const length = Math.min(block.length, cipherEnd - position);
        const { bytesRead } = await handle.read({ buffer: block, offset: 0, length, position });
        if (bytesRead === 0) throw new EnvelopeValidationError('Envelope terminou antes do esperado.');
        consume(decipher.update(block.subarray(0, bytesRead)));
        position += bytesRead;
      }
      consume(decipher.final());
    } catch (erro) {
      if (erro instanceof EnvelopeValidationError) throw erro;
      throw new EnvelopeValidationError('Autenticação AES-GCM do envelope falhou.');
    } finally {
      aesKey.fill(0);
    }
    if (!metadata) throw new EnvelopeValidationError('Metadados internos ausentes.');
    // A atribuição ocorre dentro de consume(); o compilador não acompanha a
    // mutação feita pela closure, embora a checagem acima garanta o valor.
    const validatedMetadata = metadata as Record<string, unknown>;
    if (
      validatedMetadata.sourceName !== expected.sourceName ||
      validatedMetadata.sourceSize !== Number(expected.sourceSize) ||
      validatedMetadata.sourceSha256 !== expected.sourceSha256 ||
      plaintextBytes !== expected.sourceSize ||
      payloadHash.digest('hex') !== expected.sourceSha256
    ) {
      throw new EnvelopeValidationError('Conteúdo original diverge do manifesto autenticado.');
    }
  } finally {
    await handle.close();
  }
}
