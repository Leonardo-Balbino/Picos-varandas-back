/**
 * Bootstrap dos dois admins iniciais de produção (Sessão 3 — Railway).
 * Diferente de `seed.ts` (que faz upsert e existe para resetar a senha de UM
 * admin via `ADMIN_EMAIL`/`ADMIN_PASSWORD`), este script é estritamente
 * aditivo: cria só quem ainda não existe e nunca toca em `senhaHash` de
 * quem já existe. Rodar duas vezes é seguro — não duplica, não sobrescreve
 * senha.
 *
 * Senha vem de `SEED_ADMIN_PASSWORD` (variável de ambiente, nunca fixa no
 * código) e é a mesma para os dois na primeira execução. `precisaTrocarSenha`
 * é marcado `true` na criação (reversão da decisão original deste script de
 * não modelar o campo — Passo 0.4 de uma sessão posterior): o frontend deve
 * forçar a troca no primeiro login via POST /auth/trocar-senha.
 *
 * Hash com @node-rs/argon2 (argon2id) — o mesmo algoritmo usado no login
 * (AuthService.hashSenha/argon2Verify), para não introduzir um segundo
 * esquema de hash no projeto.
 *
 * Rodar com `pnpm --filter api exec ts-node prisma/seed-admins-iniciais.ts`,
 * com DATABASE_URL apontando para o Postgres alvo (mesma URL pública usada
 * em `prisma migrate deploy` ao rodar contra produção a partir de uma
 * máquina local — ver prisma.config.ts para o motivo de migrate usar
 * DIRECT_URL e este script usar DATABASE_URL: aqui é o PrismaClient de
 * runtime falando com o banco, não o CLI).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { hash as argon2Hash } from '@node-rs/argon2';
import { PrismaClient } from '../src/generated/prisma/client';

const ADMINS_INICIAIS = [
  { email: 'leovinicius569@gmail.com', nome: 'Leo' },
  { email: 'picossistemas.adm@gmail.com', nome: 'Administrador' },
] as const;

async function main(): Promise<void> {
  const senha = requireEnv('SEED_ADMIN_PASSWORD');
  if (senha.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD precisa ter no mínimo 8 caracteres.');
  }

  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL') });
  const prisma = new PrismaClient({ adapter });

  // Hash calculado uma vez só, fora do loop — os dois admins entram com a
  // mesma senha inicial (cada um pode trocá-la depois de logar).
  const senhaHash = await argon2Hash(senha);

  for (const admin of ADMINS_INICIAIS) {
    const existente = await prisma.usuario.findUnique({ where: { email: admin.email } });
    if (existente) {
      // Idempotência: usuário já existe, não mexe em nada — nem senha, nem
      // perfil, nem `ativo`. Rodar de novo com uma senha diferente NÃO
      // reseta a senha de quem já foi criado (esse é o papel do seed.ts).
      console.log(`Já existe, nada alterado: ${existente.email} (id: ${existente.id}).`);
      continue;
    }

    const criado = await prisma.usuario.create({
      data: {
        nome: admin.nome,
        email: admin.email,
        senhaHash,
        perfil: 'admin',
        ativo: true,
        precisaTrocarSenha: true,
      },
    });
    console.log(`Criado: ${criado.email} (id: ${criado.id}).`);
  }

  await prisma.$disconnect();
}

function requireEnv(nome: string): string {
  const valor = process.env[nome];
  if (!valor) {
    throw new Error(`Variável de ambiente ${nome} é obrigatória para rodar o seed.`);
  }
  return valor;
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exit(1);
});
