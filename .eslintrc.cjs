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
  plugins: ['react', '@typescript-eslint', 'react-hooks', 'ui-kit', 'i18next'],
  settings: {
    react: {
      version: 'detect',
    },
    i18next: ['src/lib/i18n.ts'],
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'ui-kit/no-hardcoded-ui': 'error',
    // Confirm modals are banned app-wide: the standard confirm pattern is the
    // two-step ConfirmActionButton (first click arms red, second executes).
    // The UI kit itself (ConfirmDialog/ConfirmDialogHost) is exempt inside the rule.
    'ui-kit/no-confirm-dialog': 'error',
    'i18next/no-literal-string': [
      'error',
      {
        ignoredPaths: [
          // Ignore for test files
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/*.spec.ts',
          // Ignore common patterns that are not user-facing
          '.toLowerCase()',
          '.toUpperCase()',
          'Math.',
          'console.',
          'process.',
          // Ignore UI element props
          'aria-label',
          'aria-labelledby',
          'placeholder',
          'title=',
        ],
        onlyDetectingLocalFiles: true,
        detectorType: 'jsf',
      },
    ],
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
        patterns: [],
      },
    ],
  },
  overrides: [
    {
      files: ['src/App.tsx', 'src/components/layout/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@/components/ui',
                message: 'Critical-path file: use direct import (e.g. @/components/ui/Button) to avoid loading 72 components.',
              },
              {
                name: '@/components/ui/index',
                message: 'Critical-path file: use direct import (e.g. @/components/ui/Button) to avoid loading 72 components.',
              },
            ],
          },
        ],
      },
    },
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
          'error',
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
    {
      // The logger is the single module allowed to use console directly;
      // everything else must go through createLogger().
      files: ['src/lib/observability/logger.ts'],
      rules: {
        'no-console': 'off',
      },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', 'src/__tests__/**/*.ts', 'src/__tests__/**/*.tsx'],
      rules: {
        'i18next/no-literal-string': 'off',
        'no-restricted-syntax': 'off',
        'react/forbid-elements': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
  ignorePatterns: ['dist', 'node_modules', '*.config.js', '*.config.ts'],
};
