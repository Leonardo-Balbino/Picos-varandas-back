import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * Storage de arquivos (Card A4) — decisão desta sessão: volume persistente do
 * próprio Railway, não Cloudflare R2 da spec original (ver plano da sessão).
 * Diferenças práticas em relação ao fluxo de URL pré-assinada do documento:
 *
 * - Upload passa pela API (multipart), não é direto do cliente pro storage —
 *   custa CPU/memória do processo durante o upload, trade-off aceito.
 * - Sem duas etapas (pendente → confirmado) para arquivos de negócio comuns
 *   (extratos, comprovantes): o upload é síncrono, então o registro já nasce
 *   confirmado. O fluxo pendente→confirmado da spec original permanece só
 *   para o Card I4 (backup do PDV legado), que ainda valida checksum depois
 *   do upload.
 * - Download não usa URL de terceiro com TTL — é servido pela própria API,
 *   atrás do RolesGuard normal (usuário já precisa estar autenticado para
 *   acessar a rota de download; não há necessidade de um token adicional de
 *   curta duração quando o controle de acesso já é a sessão do usuário).
 *
 * `STORAGE_DIR` aponta para o volume montado em produção (Railway). Sem essa
 * variável (dev local sem volume configurado), cai num diretório dentro do
 * projeto — funciona para desenvolvimento, mas não seria persistente entre
 * deploys reais.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly baseDir: string;

  constructor() {
    this.baseDir = process.env.STORAGE_DIR ?? join(process.cwd(), '.data', 'arquivos');
  }

  /** Convenção <contexto>/<ano>/<mes>/<uuid>-<slug> (Card A4). O slug nunca é
   * o nome original cru — evita colisão e path traversal (spec original,
   * ainda válida com storage local: um nome de arquivo tipo "../../etc/passwd"
   * jamais deve virar parte do caminho no disco). */
  gerarChave(contexto: string, nomeOriginal: string): string {
    const agora = new Date();
    const ano = agora.getUTCFullYear();
    const mes = String(agora.getUTCMonth() + 1).padStart(2, '0');
    const slug = this.slugificar(nomeOriginal);
    return `${contexto}/${ano}/${mes}/${randomUUID()}-${slug}`;
  }

  async salvar(chave: string, conteudo: Buffer): Promise<void> {
    const caminho = this.caminhoAbsoluto(chave);
    await mkdir(dirname(caminho), { recursive: true });
    await writeFile(caminho, conteudo);
  }

  async ler(chave: string): Promise<Buffer> {
    return readFile(this.caminhoAbsoluto(chave));
  }

  async remover(chave: string): Promise<void> {
    await rm(this.caminhoAbsoluto(chave), { force: true });
  }

  /** Resolve a chave para um caminho absoluto dentro de `baseDir`,
   * recusando qualquer chave que tente escapar (ver gerarChave — chaves
   * geradas por este serviço nunca escapam; esta checagem é defesa em
   * profundidade contra uma chave vinda de fora, ex.: de um registro antigo
   * corrompido). */
  private caminhoAbsoluto(chave: string): string {
    const caminho = normalize(join(this.baseDir, chave));
    if (!caminho.startsWith(this.baseDir + sep) && caminho !== this.baseDir) {
      throw new AppException({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Chave de arquivo inválida.',
      });
    }
    return caminho;
  }

  private slugificar(nomeOriginal: string): string {
    const semExtensaoEspacos = nomeOriginal
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove marcas diacríticas (acentos) após NFD
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      // "." só sobra do allowlist acima para permitir extensão de arquivo —
      // mas "../" também só usa caracteres permitidos (ponto e barra), e a
      // barra já virou "-" na linha acima, deixando ".." sobrando de forma
      // inofensiva (sem separador de diretório, não atravessa nada) mas
      // esteticamente idêntica a uma tentativa de path traversal. Colapsar
      // qualquer sequência de 2+ pontos entra na mesma limpeza.
      .replace(/\.{2,}/g, '-')
      .replace(/-+/g, '-')
      .toLowerCase();
    return semExtensaoEspacos.slice(0, 80) || 'arquivo';
  }
}
