module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['react', '@typescript-eslint', 'react-hooks'],
  settings: {
    react: {
      version: 'detect',
    },
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      files: ['src/**/*.tsx'],
      excludedFiles: ['src/components/ui/**/*.tsx'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "JSXOpeningElement[name.name='input']",
            message:
              'Use UI-kit primitives instead of raw <input>. Import Input/Checkbox/Radio/Toggle from src/components/ui.',
          },
          {
            selector: "JSXOpeningElement[name.name='select']",
            message: 'Use UI-kit Select instead of raw <select>.',
          },
          {
            selector: "JSXOpeningElement[name.name='textarea']",
            message: 'Use UI-kit Textarea instead of raw <textarea>.',
          },
        ],
      },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', '*.config.js', '*.config.ts'],
};
