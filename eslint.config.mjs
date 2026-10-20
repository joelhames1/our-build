import next from 'eslint-config-next';

const config = [
  ...next,
  {
    ignores: ['.next/**', 'node_modules/**', 'eval-out/**', 'test-results/**', 'playwright-report/**'],
  },
  {
    // The core is shared by the browser and the server: keep it free of React, DOM and three.js.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['react', 'react-dom', 'three', 'three/*', '@react-three/*', 'next', 'next/*'] },
      ],
    },
  },
];

export default config;
