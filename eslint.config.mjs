import globals from 'globals';
export default [
  { ignores: ['node_modules/**', 'app/**', 'dist/**', 'artifact/**'] },
  {
    files: ['src/js/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: { ...globals.browser, V: 'readonly', MP4Box: 'readonly', tf: 'readonly', cocoSsd: 'readonly', module: 'writable', require: 'readonly', globalThis: 'readonly' } },
    rules: {
      'no-undef': 'error', 'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-self-assign': 'error', 'no-self-compare': 'error',
      'no-cond-assign': ['error', 'except-parens'], 'eqeqeq': ['warn', 'smart'], 'no-shadow-restricted-names': 'error', 'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-fallthrough': 'error', 'no-loss-of-precision': 'error', 'no-constant-condition': ['warn', { checkLoops: false }], 'use-isnan': 'error', 'valid-typeof': 'error',
      'no-unsafe-finally': 'error', 'no-async-promise-executor': 'error', 'require-atomic-updates': 'off', 'no-prototype-builtins': 'warn', 'no-useless-escape': 'warn'
    }
  },
  { files: ['tests/**/*.mjs', 'tools/**/*.mjs', 'eslint.config.mjs'], languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser, V: 'readonly' } } },
  { files: ['tests/**/*.cjs'], languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node } }
];
