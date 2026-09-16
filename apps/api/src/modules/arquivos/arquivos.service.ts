import { Injectable } from '@nestjs/common';
import type { ArquivoResposta, ContextoArquivo } from 'contracts';
import { AppException } from '../../common/exceptions/app.exception';
import { StorageService } from '../../infra/storage/storage.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { Arquivo } from '../../generated/prisma/client';

const TAMANHO_MAXIMO_BYTES = 20 * 1024 * 1024; // 20 MB (Card A4)

/** Allowlist de mimeType por contexto (Card A4). `extrato` inclui xlsx além
 * do trio original csv/ofx/pdf da spec — achado real desta sessão: o
 * extrato bancário tradicional do restaurante (não o do adquirente PixPag,
 * que é csv) vem como planilha .xlsx exportada do internet banking, não um
 * dos três formatos originalmente previstos. */
const MIME_PERMITIDO: Record<ContextoArquivo, readonly string[]> = {
  extrato: [
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel', // alguns navegadores mandam .csv com este mimetype
    'application/x-ofx',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  ],
  comprovante: ['application/pdf', 'image/jpeg', 'image/png'],
  backup: ['application/gzip', 'application/x-gzip', 'application/octet-stream'],
};

export interface ArquivoParaProcessamento {
  registro: Arquivo;
  buffer: Buffer;
}

@Injectable()
export class ArquivosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async upload(
    arquivo: Express.Multer.File | undefined,
    contexto: ContextoArquivo,
    usuarioId: string,
  ): Promise<ArquivoResposta> {
    if (!arquivo) {
      throw new AppException({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Nenhum arquivo enviado.',
        fields: { arquivo: 'Campo obrigatório (multipart/form-data).' },
      });
    }

    if (arquivo.size > TAMANHO_MAXIMO_BYTES) {
      throw new AppException({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Arquivo excede o limite de 20 MB.',
        fields: { arquivo: `Tamanho recebido: ${arquivo.size} bytes.` },
      });
    }

    const permitidos = MIME_PERMITIDO[contexto];
    if (!permitidos.includes(arquivo.mimetype)) {
      throw new AppException({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: `Tipo de arquivo não permitido para o contexto "${contexto}".`,
        fields: { mimeType: arquivo.mimetype },
      });
    }

    this.validarAssinaturaBytes(arquivo.buffer, arquivo.mimetype);

    const chaveArquivo = this.storage.gerarChave(contexto, arquivo.originalname);
    await this.storage.salvar(chaveArquivo, arquivo.buffer);

    const registro = await this.prisma.arquivo.create({
      data: {
        chaveArquivo,
        nomeOriginal: arquivo.originalname,
        mimeType: arquivo.mimetype,
        tamanhoBytes: arquivo.size,
        contexto,
        status: 'confirmado', // upload síncrono (volume local) — sem etapa pendente aqui, ver storage.service.ts
        usuarioId,
      },
    });

    return this.paraResposta(registro);
  }

  async baixar(id: string): Promise<{ buffer: Buffer; nomeOriginal: string; mimeType: string }> {
    const registro = await this.buscarOuFalhar(id);
    const buffer = await this.storage.ler(registro.chaveArquivo);
    return { buffer, nomeOriginal: registro.nomeOriginal, mimeType: registro.mimeType };
  }

  /** Usado por consumidores internos (Card D1 — processar extrato) que
   * precisam do arquivo + registro, não só do buffer, e querem confirmar o
   * contexto esperado antes de processar (evita processar um comprovante
   * como se fosse extrato por engano). */
  async carregarParaProcessamento(
    arquivoId: string,
    contextoEsperado: ContextoArquivo,
  ): Promise<ArquivoParaProcessamento> {
    const registro = await this.buscarOuFalhar(arquivoId);
    if (registro.contexto !== contextoEsperado) {
      throw new AppException({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: `Arquivo não é do contexto "${contextoEsperado}" (é "${registro.contexto}").`,
      });
    }
    const buffer = await this.storage.ler(registro.chaveArquivo);
    return { registro, buffer };
  }

  private async buscarOuFalhar(id: string): Promise<Arquivo> {
    const registro = await this.prisma.arquivo.findUnique({ where: { id } });
    if (!registro) {
      throw new AppException({ status: 404, code: 'NOT_FOUND', message: 'Arquivo não encontrado.' });
    }
    return registro;
  }

  private paraResposta(registro: Arquivo): ArquivoResposta {
    return {
      arquivoId: registro.id,
      chaveArquivo: registro.chaveArquivo,
      nomeOriginal: registro.nomeOriginal,
      mimeType: registro.mimeType,
      tamanhoBytes: registro.tamanhoBytes,
      contexto: registro.contexto,
    };
  }

  private validarAssinaturaBytes(buffer: Buffer, mimeType: string): void {
    if (buffer.length === 0) {
      throw new AppException({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Arquivo vazio.',
      });
    }

    // Bloqueia executáveis binários (Windows PE / Linux ELF)
    if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
      throw new AppException({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Executáveis binários não são permitidos.',
      });
    }
    if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
      throw new AppException({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Executáveis binários não são permitidos.',
      });
    }

    if (mimeType === 'application/pdf') {
      const isPdf = buffer.subarray(0, 5).toString('ascii').startsWith('%PDF');
      if (!isPdf) {
        throw new AppException({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Conteúdo do arquivo não corresponde a um PDF válido.',
        });
      }
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
      if (!isZip) {
        throw new AppException({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Conteúdo do arquivo não corresponde a uma planilha XLSX válida.',
        });
      }
    } else if (mimeType === 'image/jpeg') {
      const isJpg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
      if (!isJpg) {
        throw new AppException({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Conteúdo do arquivo não corresponde a uma imagem JPEG válida.',
        });
      }
    } else if (mimeType === 'image/png') {
      const isPng = buffer.length >= 8 &&
        buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
        buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a;
      if (!isPng) {
        throw new AppException({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Conteúdo do arquivo não corresponde a uma imagem PNG válida.',
        });
      }
    } else if (['text/csv', 'application/csv', 'application/x-ofx'].includes(mimeType)) {
      const amostra = buffer.subarray(0, Math.min(buffer.length, 1024));
      if (amostra.includes(0x00)) {
        throw new AppException({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'O arquivo contém caracteres binários incompatíveis com arquivo de texto/extrato.',
        });
      }
    }
  }
}
