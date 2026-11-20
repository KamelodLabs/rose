// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const complexity = require('../eslint.complexity.cjs');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  { files: ['src/**/*.{ts,tsx}'], rules: complexity.complexityRules },
  {
    files: ['src/**/*.tsx'],
    rules: complexity.tsxRules,
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: complexity.testRules,
  },
  {
    files: ['src/hooks/use-color-scheme.web.ts'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
