import {
  constants,
  createCipheriv,
  createHash,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnvelopeValidationError, validatePvaEnvelope } from './pva-envelope.validator';

describe('validatePvaEnvelope', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
  const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicDer = pair.publicKey.export({ type: 'spki', format: 'der' });
  const source = randomBytes(1024 * 1024 + 13);
  const sourceHash = createHash('sha256').update(source).digest('hex');
  let directory: string;

  beforeAll(() => {
    process.env.BACKUP_PRIVATE_KEY_BASE64 = Buffer.from(privatePem).toString('base64');
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'pva-validator-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  afterAll(() => {
    delete process.env.BACKUP_PRIVATE_KEY_BASE64;
  });

  function envelope(): Buffer {
    const aes = randomBytes(32);
    const nonce = randomBytes(12);
    const wrapped = publicEncrypt(
      { key: pair.publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      aes,
    );
    const header = Buffer.from(
      JSON.stringify({
        version: 1,
        algorithm: 'RSA-OAEP-SHA256+AES-256-GCM',
        keyFingerprint: createHash('sha256').update(publicDer).digest('hex'),
        wrappedKey: wrapped.toString('base64'),
        nonce: nonce.toString('base64'),
      }),
      'ascii',
    );
    const prefix = Buffer.alloc(12);
    prefix.write('PVAENC01', 0, 'ascii');
    prefix.writeUInt32BE(header.length, 8);
    const aad = Buffer.concat([prefix, header]);
    const metadata = Buffer.from(
      JSON.stringify({ sourceName: 'backup.zip', sourceSize: source.length, sourceSha256: sourceHash }),
    );
    const metadataPrefix = Buffer.alloc(4);
    metadataPrefix.writeUInt32BE(metadata.length);
    const cipher = createCipheriv('aes-256-gcm', aes, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.concat([metadataPrefix, metadata, source])),
      cipher.final(),
    ]);
    return Buffer.concat([aad, ciphertext, cipher.getAuthTag()]);
  }

  it('autentica cabeçalho, metadados e conteúdo original', async () => {
    const path = join(directory, 'ok.pva');
    await writeFile(path, envelope());
    await expect(
      validatePvaEnvelope(path, {
        sourceName: 'backup.zip',
        sourceSize: BigInt(source.length),
        sourceSha256: sourceHash,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejeita qualquer alteração no ciphertext', async () => {
    const altered = envelope();
    altered[altered.length - 20] ^= 1;
    const path = join(directory, 'altered.pva');
    await writeFile(path, altered);
    await expect(
      validatePvaEnvelope(path, {
        sourceName: 'backup.zip',
        sourceSize: BigInt(source.length),
        sourceSha256: sourceHash,
      }),
    ).rejects.toBeInstanceOf(EnvelopeValidationError);
  });
});
