// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const complexityRules = {
  complexity: ['error', { max: 10 }],
  'max-depth': ['error', { max: 4 }],
  'max-params': ['error', { max: 4 }],
  'max-lines-per-function': [
    'error',
    { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
  ],
  'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'hack'], location: 'start' }],
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  { files: ['src/**/*.{ts,tsx}'], rules: complexityRules },
  {
    files: ['src/**/*.tsx'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 150, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: { complexity: 'off', 'max-lines-per-function': 'off' },
  },
  {
    files: ['src/hooks/use-color-scheme.web.ts'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
