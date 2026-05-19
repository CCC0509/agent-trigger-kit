import js from '@eslint/js';

const nodeGlobals = Object.fromEntries(
  ['Buffer', 'URL', 'URLSearchParams', 'clearTimeout', 'console', 'process', 'setTimeout'].map(
    (name) => [name, 'readonly'],
  ),
);

export default [
  {
    ignores: ['coverage/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      globals: nodeGlobals,
      sourceType: 'module',
    },
  },
];
