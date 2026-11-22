import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import complexity from '../eslint.complexity.cjs';
import modularity from '../eslint.modularity.cjs';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ['src/**/*.{ts,tsx}'], rules: complexity.complexityRules },
  {
    files: ['src/**/*.tsx'],
    rules: complexity.tsxRules,
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    rules: complexity.testRules,
  },
  ...modularity,
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
