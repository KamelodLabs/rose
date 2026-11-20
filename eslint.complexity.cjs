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

const tsxRules = {
  'max-lines-per-function': [
    'error',
    { max: 150, skipBlankLines: true, skipComments: true, IIFEs: true },
  ],
};

const testRules = {
  complexity: 'off',
  'max-lines-per-function': 'off',
};

module.exports = { complexityRules, tsxRules, testRules };
