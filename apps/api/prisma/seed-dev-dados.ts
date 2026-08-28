/**
 * Dados de demonstração para desenvolvimento local — popula todos os
 * módulos novos (dashboard, conciliação, financeiro, fechamento,
 * usuários, configurações) com registros plausíveis, para as telas do
 * frontend pararem de parecer vazias assim que os flags `MODULOS_PRONTOS`
 * forem ligados. NÃO roda em produção (script solto, não faz parte de
 * `prisma migrate deploy` nem do `migrations.seed` de prisma.config.ts).
 *
 * Pré-requisito: `prisma/seed.ts` já ter rodado (precisa existir um
 * usuário admin — busca por `ADMIN_EMAIL`, default `admin@varanda.local`).
 *
 * Idempotente por natureza best-effort: usa `skipDuplicates`/upsert onde dá
 * (categorias, taxas fixas), mas vendas/extratos/lançamentos são
 * recriados a cada execução (apagados no início) para as datas relativas
 * a "hoje" continuarem fazendo sentido (vencendo em 7 dias, mês corrente
 * etc.) mesmo rodando este script dias depois.
 *
 * Rodar com:
 *   pnpm --filter api exec ts-node prisma/seed-dev-dados.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL') });
  const prisma = new PrismaClient({ adapter });

  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@varanda.local';
  const admin = await prisma.usuario.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    throw new Error(
      `Usuário admin "${adminEmail}" não encontrado — rode prisma/seed.ts primeiro (ADMIN_EMAIL/ADMIN_PASSWORD).`,
    );
  }

  const hoje = new Date();
  const anoAtual = hoje.getUTCFullYear();
  const mesAtual = hoje.getUTCMonth(); // 0-indexado

  // -----------------------------------------------------------------
  // Segundo usuário (operador) — para a lista de Usuários não mostrar só
  // um admin sozinho.
  // -----------------------------------------------------------------
  await prisma.usuario.upsert({
    where: { email: 'operador.demo@varanda.local' },
    update: {},
    create: {
      nome: 'Operador Demonstração',
      email: 'operador.demo@varanda.local',
      perfil: 'operador',
      ativo: true,
      // Sem senhaHash: só entra por reset/cadastro do admin. Não é um
      // usuário para logar hoje, só para popular a listagem.
    },
  });

  // -----------------------------------------------------------------
  // Categorias
  // -----------------------------------------------------------------
  const categorias = ['Fornecedores', 'Aluguel', 'Energia', 'Água', 'Internet', 'Manutenção', 'Marketing', 'Salários'];
  await prisma.categoria.createMany({
    data: categorias.map((nome) => ({ nome })),
    skipDuplicates: true,
  });

  // -----------------------------------------------------------------
  // Taxas de gateway (só cria se ainda não houver nenhuma vigente)
  // -----------------------------------------------------------------
  const taxasExistentes = await prisma.taxaGateway.count();
  if (taxasExistentes === 0) {
    await prisma.taxaGateway.createMany({
      data: [
        { meioPagamento: 'pix', percentual: 0.99, diasLiquidacao: 0, vigenciaInicio: new Date(Date.UTC(anoAtual, 0, 1)) },
        {
          meioPagamento: 'cartao_credito',
          bandeira: 'Visa',
          percentual: 2.39,
          diasLiquidacao: 30,
          vigenciaInicio: new Date(Date.UTC(anoAtual, 0, 1)),
        },
        {
          meioPagamento: 'cartao_debito',
          bandeira: 'Visa',
          percentual: 1.39,
          diasLiquidacao: 1,
          vigenciaInicio: new Date(Date.UTC(anoAtual, 0, 1)),
        },
      ],
    });
  }

  // -----------------------------------------------------------------
  // Limpa dados transacionais de demo anteriores (relativos a "hoje") para
  // recriar com datas atuais — nesta ordem por causa das FKs.
  // -----------------------------------------------------------------
  await prisma.movimentacaoCaixa.deleteMany({ where: { responsavel: 'Seed Demo' } });

  // Não só `observacao: 'Seed demo'` — qualquer conciliação (inclusive testada manualmente via
  // curl/UI fora deste script) que referencie um extrato "Banco Demo" ou uma venda "seed-*" tem
  // que ser limpa antes, senão o DELETE de extratos/vendas abaixo esbarra em FK.
  const conciliacoesParaLimpar = await prisma.conciliacao.findMany({
    where: {
      OR: [
        { extratos: { some: { extrato: { banco: 'Banco Demo' } } } },
        { itensVenda: { some: { vendaPdv: { idExternoPdv: { startsWith: 'seed' } } } } },
      ],
    },
    select: { id: true },
  });
  const idsConciliacaoParaLimpar = conciliacoesParaLimpar.map((c) => c.id);
  await prisma.conciliacaoExtrato.deleteMany({ where: { conciliacaoId: { in: idsConciliacaoParaLimpar } } });
  await prisma.conciliacaoItemVenda.deleteMany({ where: { conciliacaoId: { in: idsConciliacaoParaLimpar } } });
  await prisma.conciliacao.deleteMany({ where: { id: { in: idsConciliacaoParaLimpar } } });

  await prisma.contaReceber.deleteMany({ where: { origemDescricao: { startsWith: '[SEED]' } } });
  await prisma.contaPagar.deleteMany({ where: { codigo: { startsWith: 'SEED-' } } });
  await prisma.extratoBancario.deleteMany({ where: { banco: 'Banco Demo' } });
  await prisma.vendaPdv.deleteMany({ where: { idExternoPdv: { startsWith: 'seed' } } });
  await prisma.arquivo.deleteMany({ where: { chaveArquivo: 'seed/extrato-demo.csv' } });

  // -----------------------------------------------------------------
  // Arquivo "fictício" para as linhas de extrato apontarem (FK obrigatória)
  // -----------------------------------------------------------------
  const arquivoDemo = await prisma.arquivo.create({
    data: {
      chaveArquivo: 'seed/extrato-demo.csv',
      nomeOriginal: 'extrato-demo.csv',
      mimeType: 'text/csv',
      tamanhoBytes: 0,
      contexto: 'extrato',
      status: 'confirmado',
      usuarioId: admin.id,
    },
  });

  // -----------------------------------------------------------------
  // Vendas PDV + extratos do mês corrente — algumas já conciliadas
  // (com vínculo de verdade, criando Conciliacao/ConciliacaoExtrato/
  // ConciliacaoItemVenda), outras pendentes.
  // -----------------------------------------------------------------
  const dataDia = (dia: number, hora = 12) => new Date(Date.UTC(anoAtual, mesAtual, dia, hora));

  const vendas = await Promise.all(
    [
      { dia: 2, cupom: '1001', forma: 'pix' as const, bruto: 154.0, taxa: 0 },
      { dia: 4, cupom: '1002', forma: 'cartao_credito' as const, bruto: 320.5, taxa: 0.0239 },
      { dia: 6, cupom: '1003', forma: 'cartao_debito' as const, bruto: 89.9, taxa: 0.0139 },
      { dia: 9, cupom: '1004', forma: 'dinheiro' as const, bruto: 45.0, taxa: 0 },
      { dia: 12, cupom: '1005', forma: 'pix' as const, bruto: 210.0, taxa: 0 },
      { dia: 15, cupom: '1006', forma: 'cartao_credito' as const, bruto: 178.3, taxa: 0.0239 },
    ].map(({ dia, cupom, forma, bruto, taxa }) => {
      const liquido = Number((bruto * (1 - taxa)).toFixed(2));
      return prisma.vendaPdv.create({
        data: {
          idExternoPdv: `seed-${cupom}`,
          numeroCupom: cupom,
          dataHora: dataDia(dia),
          valorBruto: bruto,
          valorLiquido: liquido,
          formaPagamento: forma,
          statusConciliacao: 'pendente',
        },
      });
    }),
  );

  const extratos = await Promise.all(
    [
      { dia: 2, desc: 'PIX RECEBIDO - CUPOM 1001', valor: 154.0 },
      { dia: 5, desc: 'CRED CARTAO VISA LOTE 88', valor: 312.85 },
      { dia: 20, desc: 'TARIFA MANUTENCAO CONTA', valor: 29.9, tipo: 'debito' as const },
    ].map(({ dia, desc, valor, tipo }) =>
      prisma.extratoBancario.create({
        data: {
          banco: 'Banco Demo',
          conta: '0001-1',
          dataTransacao: dataDia(dia, 0),
          descricaoOrigem: desc,
          tipoTransacao: tipo ?? 'credito',
          valor,
          hashDuplicidade: `seed-hash-${dia}-${desc}`,
          arquivoId: arquivoDemo.id,
        },
      }),
    ),
  );

  // Vincula a primeira venda (PIX) ao primeiro extrato — conciliação
  // manual de verdade, igual ao que POST /conciliacao/vincular faz.
  const conciliacaoDemo = await prisma.conciliacao.create({
    data: {
      dataConciliacao: dataDia(2, 0),
      valorExtrato: 154.0,
      valorPdv: 154.0,
      valorTaxaGateway: 4.5,
      diferencaAjuste: 0,
      tipoConciliacao: 'manual',
      usuarioId: admin.id,
      observacao: 'Seed demo',
    },
  });
  await prisma.conciliacaoExtrato.create({
    data: { conciliacaoId: conciliacaoDemo.id, extratoId: extratos[0].id },
  });
  await prisma.conciliacaoItemVenda.create({
    data: { conciliacaoId: conciliacaoDemo.id, vendaPdvId: vendas[0].id },
  });
  await prisma.extratoBancario.update({ where: { id: extratos[0].id }, data: { statusConciliacao: 'conciliado' } });
  await prisma.vendaPdv.update({ where: { id: vendas[0].id }, data: { statusConciliacao: 'conciliado' } });

  // -----------------------------------------------------------------
  // Vendas para testar o match automático — busca lançamentos de crédito
  // pendentes JÁ importados de verdade (extratos reais, não os de seed
  // acima) e cria uma venda PDV com valorLiquido idêntico para cada um,
  // para POST /conciliacao/match-auto ter o que casar de propósito.
  // Dinâmico (não hardcoded) para continuar funcionando mesmo que o
  // extrato real importado mude entre execuções deste script.
  // -----------------------------------------------------------------
  await prisma.vendaPdv.deleteMany({ where: { idExternoPdv: { startsWith: 'seed-match-' } } });

  const extratosParaCasar = await prisma.extratoBancario.findMany({
    where: { tipoTransacao: 'credito', statusConciliacao: 'pendente', banco: { not: 'Banco Demo' } },
    orderBy: { valor: 'desc' },
    take: 8,
  });

  if (extratosParaCasar.length === 0) {
    console.log(
      'Nenhum extrato real pendente encontrado — pulando criação de vendas de match (importe um extrato pela tela antes, se quiser testar o match automático).',
    );
  } else {
    // "PIX RECEBIDO" direto em conta corrente não passa por adquirente (sem taxa) — venda vira
    // pix com valorLiquido == valorBruto. Qualquer outra descrição é tratada como liquidação de
    // adquirente/cartão — venda vira cartao_credito com uma taxa nominal de 2,39% embutida no
    // bruto, só para o valor bruto não ficar idêntico ao líquido na tela.
    await prisma.vendaPdv.createMany({
      data: extratosParaCasar.map((extrato, indice) => {
        const ehPix = extrato.descricaoOrigem.toUpperCase().includes('PIX RECEBIDO');
        const valorLiquido = Number(extrato.valor);
        const valorBruto = ehPix ? valorLiquido : Number((valorLiquido / (1 - 0.0239)).toFixed(2));
        return {
          idExternoPdv: `seed-match-${indice}`,
          numeroCupom: String(2001 + indice),
          dataHora: new Date(
            Date.UTC(
              extrato.dataTransacao.getUTCFullYear(),
              extrato.dataTransacao.getUTCMonth(),
              extrato.dataTransacao.getUTCDate(),
              13 + indice,
            ),
          ),
          valorBruto,
          valorDesconto: 0,
          valorLiquido,
          formaPagamento: ehPix ? 'pix' : 'cartao_credito',
          statusConciliacao: 'pendente',
        };
      }),
    });
    console.log(`${extratosParaCasar.length} venda(s) criada(s) para casar com extrato real via match automático.`);
  }

  // Mais algumas vendas pendentes SEM par no extrato — para a tela de conciliação não mostrar só
  // itens que já têm match na cara, e o match automático ter "ruído" de verdade para ignorar.
  await prisma.vendaPdv.deleteMany({ where: { idExternoPdv: { startsWith: 'seed-semmatch-' } } });
  await prisma.vendaPdv.createMany({
    data: [
      { idExternoPdv: 'seed-semmatch-1', numeroCupom: '2101', dataHora: dataDia(18, 12), valorBruto: 67.9, valorDesconto: 0, valorLiquido: 67.9, formaPagamento: 'dinheiro' as const, statusConciliacao: 'pendente' as const },
      { idExternoPdv: 'seed-semmatch-2', numeroCupom: '2102', dataHora: dataDia(19, 19), valorBruto: 145.0, valorDesconto: 5, valorLiquido: 140.0, formaPagamento: 'cartao_debito' as const, statusConciliacao: 'pendente' as const },
    ],
  });

  // -----------------------------------------------------------------
  // Contas a pagar — vencida, vencendo hoje, vencendo em 3 dias e uma já
  // paga.
  // -----------------------------------------------------------------
  await prisma.contaPagar.createMany({
    data: [
      {
        codigo: 'SEED-00001',
        fornecedor: 'Distribuidora Central',
        categoria: 'Fornecedores',
        valor: 1250.0,
        dataVencimento: new Date(hoje.getTime() - 3 * 24 * 60 * 60 * 1000),
        status: 'pendente',
        criadoPorId: admin.id,
      },
      {
        codigo: 'SEED-00002',
        fornecedor: 'Energia Elétrica Cia.',
        categoria: 'Energia',
        valor: 640.2,
        dataVencimento: hoje,
        status: 'pendente',
        criadoPorId: admin.id,
      },
      {
        codigo: 'SEED-00003',
        fornecedor: 'Provedor de Internet',
        categoria: 'Internet',
        valor: 199.9,
        dataVencimento: new Date(hoje.getTime() + 3 * 24 * 60 * 60 * 1000),
        status: 'pendente',
        criadoPorId: admin.id,
      },
      {
        codigo: 'SEED-00004',
        fornecedor: 'Imobiliária Varanda',
        categoria: 'Aluguel',
        valor: 4500.0,
        dataVencimento: dataDia(5, 0),
        dataPagamento: dataDia(5, 0),
        formaPagamento: 'pix',
        origemRecurso: 'conta_bancaria',
        status: 'pago',
        criadoPorId: admin.id,
      },
    ],
  });

  // -----------------------------------------------------------------
  // Contas a receber — previsões do mês
  // -----------------------------------------------------------------
  await prisma.contaReceber.createMany({
    data: [
      {
        codigo: 'SEED-CR-00001',
        origemDescricao: '[SEED] Lote cartão de crédito 08/xx',
        meioPagamento: 'cartao_credito',
        valorBruto: 320.5,
        valorTaxaEstimada: 7.66,
        valorLiquidoPrevisto: 312.84,
        dataPrevisao: dataDia(20, 0),
        status: 'pendente',
      },
      {
        codigo: 'SEED-CR-00002',
        origemDescricao: '[SEED] Lote cartão de débito 08/xx',
        meioPagamento: 'cartao_debito',
        valorBruto: 89.9,
        valorTaxaEstimada: 1.25,
        valorLiquidoPrevisto: 88.65,
        dataPrevisao: dataDia(7, 0),
        status: 'recebido',
        dataRecebimento: dataDia(7, 0),
      },
    ],
  });

  // -----------------------------------------------------------------
  // Caixa físico — suprimento no início do mês, sangria e uma despesa
  // avulsa
  // -----------------------------------------------------------------
  await prisma.movimentacaoCaixa.createMany({
    data: [
      {
        dataHora: dataDia(1, 9),
        tipo: 'suprimento',
        valor: 500.0,
        descricao: 'Suprimento inicial do caixa',
        responsavel: 'Seed Demo',
        usuarioId: admin.id,
      },
      {
        dataHora: dataDia(10, 18),
        tipo: 'sangria',
        valor: 150.0,
        descricao: 'Sangria para depósito bancário',
        responsavel: 'Seed Demo',
        usuarioId: admin.id,
      },
      {
        dataHora: dataDia(14, 15),
        tipo: 'despesa_caixa',
        valor: 60.0,
        descricao: 'Compra de material de limpeza',
        categoria: 'Manutenção',
        responsavel: 'Seed Demo',
        usuarioId: admin.id,
      },
    ],
  });

  // -----------------------------------------------------------------
  // Fechamento — mês anterior trancado, para o cadeado aparecer fechado
  // na grade (a grade do ano corrente inteiro é auto-criada por
  // FechamentoService.listarFechamentos() na primeira leitura).
  // -----------------------------------------------------------------
  const mesAnterior = mesAtual === 0 ? 12 : mesAtual;
  const anoMesAnterior = mesAtual === 0 ? anoAtual - 1 : anoAtual;
  await prisma.fechamentoMensal.upsert({
    where: { ano_mes: { ano: anoMesAnterior, mes: mesAnterior } },
    update: {},
    create: {
      ano: anoMesAnterior,
      mes: mesAnterior,
      faturamentoTotal: 18500.0,
      despesasTotal: 9800.0,
      saldoFinal: 8700.0,
      trancado: true,
      trancadoPorId: admin.id,
      trancadoEm: new Date(Date.UTC(anoMesAnterior, mesAnterior, 28)),
    },
  });

  console.log('Dados de demonstração prontos.');
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
