// ESLint: catches likely bugs in the TypeScript code. Run: npm run lint
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.deps/', 'build/', 'dist/', 'node_modules/', 'bin/', 'models/', 'samples/', 'design/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node side: main process, preloads, tests, scripts
    files: ['src/main/**', 'src/preload/**', 'src/shared/**', 'test/**', 'scripts/**', '*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // The two windows are plain browser scripts whose functions are used from other files
    // (index.html, scripts/ui-check.ts), so "unused" top-level functions are expected.
    files: ['src/renderer/**', 'src/recorder/**'],
    languageOptions: { globals: globals.browser },
    rules: { '@typescript-eslint/no-unused-vars': ['error', { vars: 'local' }] },
  },
  {
    rules: {
      // `catch {}` without a variable and `() => {}` placeholders are used on purpose.
      '@typescript-eslint/no-empty-function': 'off',
    },
  }
);
