/**
 * Testes unitários — co-localizados com o código (`src/**\/*.spec.ts`),
 * convenção padrão do Nest CLI que `tsconfig.build.json` já excluía do
 * build de produção antes mesmo de existir um teste (Card A3 chegou depois
 * do esqueleto do Card A1). Testes e2e (`test/*.e2e-spec.ts`, que sobem a
 * aplicação inteira) usam config própria — ver test/jest-e2e.json — porque
 * têm setup diferente (Postgres efêmero, `supertest` batendo na app real),
 * não cabem no mesmo `testMatch` deste arquivo.
 *
 * `rootDir` fica na raiz do pacote (não `src/`) de propósito: ts-jest
 * resolve o tsconfig relativo a `rootDir`, e é o `tsconfig.json` da raiz
 * de apps/api (com @types/jest visível via node_modules/@types) que
 * precisa ser usado — apontar rootDir para `src/` faz ts-jest não achar
 * esse tsconfig e os globals do Jest (describe/it/expect) saem como erro
 * de tipo.
 */
const path = require('node:path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: {
    '^contracts$': '<rootDir>/../../packages/contracts/src/index.ts',
  },
  transform: {
    // Caminho absoluto, não '<rootDir>/tsconfig.json': o token <rootDir>
    // só é substituído pelo Jest nas chaves de config que ele conhece
    // (testMatch, moduleNameMapper...), não dentro do objeto de opções
    // arbitrário do segundo elemento de `transform`.
    //
    // tsconfig.spec.json, não tsconfig.json: este TypeScript 6.0.3 não
    // inclui @types/jest automaticamente por estar presente em
    // node_modules/@types (diferente do comportamento clássico do TS) —
    // precisa do `types: ["node", "jest"]` explícito. Isolado num tsconfig
    // à parte para não tocar no tsconfig.json de produção (usado pelo
    // `nest build`) só por causa dos globals de teste.
    '^.+\\.ts$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.spec.json') }],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: 'coverage',
};
