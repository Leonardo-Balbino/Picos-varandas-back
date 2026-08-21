/**
 * Seed do primeiro usuário admin (Card B1). Sem isso não há como fazer o
 * primeiro login em produção — o CRUD de usuários (Card J1, que permitiria
 * criar o segundo usuário em diante) exige, ele mesmo, estar autenticado
 * como admin.
 *
 * Senha vem de variável de ambiente, nunca fixa no código (Card B1).
 * Rodado via `prisma migrate deploy` + `prisma db seed` (configurado em
 * prisma.config.ts, campo migrations.seed) ou diretamente com
 * `pnpm prisma:api db seed`.
 *
 * Idempotente: upsert por e-mail. Rodar de novo com a mesma
 * ADMIN_PASSWORD não duplica nem falha; rodar com uma ADMIN_PASSWORD nova
 * atualiza a senha do admin existente — útil para reset em produção sem
 * acesso direto ao banco.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { hash as argon2Hash } from '@node-rs/argon2';
import { PrismaClient } from '../src/generated/prisma/client';

async function main(): Promise<void> {
  const email = requireEnv('ADMIN_EMAIL');
  const senha = requireEnv('ADMIN_PASSWORD');
  const nome = process.env.ADMIN_NOME ?? 'Administrador';

  if (senha.length < 8) {
    throw new Error('ADMIN_PASSWORD precisa ter no mínimo 8 caracteres.');
  }

  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL') });
  const prisma = new PrismaClient({ adapter });

  const senhaHash = await argon2Hash(senha);

  const usuario = await prisma.usuario.upsert({
    where: { email },
    create: { nome, email, senhaHash, perfil: 'admin', ativo: true },
    // token_version incrementa no update para invalidar qualquer sessão
    // antiga caso o seed esteja sendo usado para resetar a senha de um
    // admin comprometido — mesmo mecanismo de inativação do Card J1.
    update: { senhaHash, ativo: true, tokenVersion: { increment: 1 } },
  });

  console.log(`Usuário admin pronto: ${usuario.email} (id: ${usuario.id}).`);
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
