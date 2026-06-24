/**
 * ESLint config (classic, ESLint 8). The repo shipped the eslint/typescript-eslint
 * devDependencies and a `lint` script but no config file, so `npm run lint` failed outright.
 * This wires up TypeScript + React-hooks linting over src/tests/e2e.
 */
module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2021, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', 'dev-dist', 'node_modules', 'public', 'coverage', '*.config.*', 'scripts'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    // Allow intentional throwaways prefixed with _ (matches the tsconfig noUnusedParameters style).
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    'no-empty': ['error', { allowEmptyCatch: true }],
  },
};
