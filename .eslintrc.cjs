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
  plugins: ['react', '@typescript-eslint', 'react-hooks', 'ui-kit'],
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
    'ui-kit/no-hardcoded-ui': 'warn',
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@/types',
            message:
              "Types barrel is forbidden. Import directly from '@/types/ui', '@/types/generated', or specific type modules.",
          },
          {
            name: '@/types/index',
            message:
              "Types barrel is forbidden. Import directly from '@/types/ui', '@/types/generated', or specific type modules.",
          },
          {
            name: '@/types/index.ts',
            message:
              "Types barrel is forbidden. Import directly from '@/types/ui', '@/types/generated', or specific type modules.",
          },
        ],
        patterns: [
          {
            group: ['**/components/ui/*'],
            message: "Import UI primitives from '@/components/ui' only (single entrypoint).",
          },
        ],
      },
    ],
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
        'react/forbid-elements': [
          'warn',
          {
            forbid: [
              {
                element: 'button',
                message:
                  'Prefer UI-kit Button/IconButton/TabButton. Raw <button> is allowed only inside src/components/ui.',
              },
              {
                element: 'table',
                message:
                  'Prefer UI-kit Table primitives (Table/TableHeader/TableBody/TableRow/TableHead/TableCell).',
              },
              {
                element: 'thead',
                message:
                  'Prefer UI-kit TableHeader instead of raw <thead> outside src/components/ui.',
              },
              {
                element: 'tbody',
                message:
                  'Prefer UI-kit TableBody instead of raw <tbody> outside src/components/ui.',
              },
              {
                element: 'tr',
                message: 'Prefer UI-kit TableRow instead of raw <tr> outside src/components/ui.',
              },
              {
                element: 'th',
                message: 'Prefer UI-kit TableHead instead of raw <th> outside src/components/ui.',
              },
              {
                element: 'td',
                message: 'Prefer UI-kit TableCell instead of raw <td> outside src/components/ui.',
              },
              {
                element: 'a',
                message:
                  'Prefer router/link primitives (or dedicated UI link component) over raw <a> where possible.',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', '*.config.js', '*.config.ts'],
};
