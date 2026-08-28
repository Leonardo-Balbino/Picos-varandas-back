// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Config mínima (Card A3): pega os erros baratos — variável não usada,
 * import quebrado, `any` implícito, promise não tratada — sem lint
 * type-aware (que exigiria apontar para tsconfig.json e ficaria
 * sensivelmente mais lento no CI a cada push). Suficiente como gate de CI
 * para hoje; se o projeto crescer, trocar `recommended` por
 * `recommendedTypeChecked` é a evolução natural, não uma reescrita.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'src/generated/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Decorators do Nest (@Injectable(), @Controller(), etc.) e DI por
      // construtor colidem com a regra "unused vars" em parâmetros de
      // classe quando o parâmetro só existe para o Nest injetar — o padrão
      // `_` de prefixo cobre o caso real de variável intencionalmente não
      // usada sem desligar a regra inteira.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
