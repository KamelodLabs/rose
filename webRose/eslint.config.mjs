import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

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

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
