// Mantém o padrão type-aware; somente os testes F7 fora do tsconfig padrão usam o lint sintático.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**'] },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: process.cwd() } },
  },
  {
    files: ['test/rm089-f7-recibo-forte.test.ts', 'test/rm089-f7-transporte-excecao.test.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
