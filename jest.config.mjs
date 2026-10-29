/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // react-i18next is not installed; stub it so tests that import it compile.
    '^react-i18next$': '<rootDir>/src/__tests__/__mocks__/react-i18next.ts',
    '\\.(css|less|scss|sass)$': '<rootDir>/src/__tests__/__mocks__/styleMock.ts',
    '\\.(gif|ttf|eot|svg|png|jpg|jpeg|webp)$': '<rootDir>/src/__tests__/__mocks__/fileMock.ts',
  },
  transform: {
    // Custom wrapper: replaces `import.meta.env.*` with plain values BEFORE
    // ts-jest compiles TypeScript, fixing the CJS-mode SyntaxError that Vite
    // source files cause in Jest. Avoids switching to babel-jest (which would
    // break jest.mock() hoisting for variables declared outside factory fns).
    '^.+\\.tsx?$': [
      '<rootDir>/jest/transformers/ts-jest-import-meta.cjs',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowImportingTsExtensions: false,
          noEmit: false,
          strict: true,
          paths: {
            '@/*': ['src/*'],
          },
        },
        diagnostics: { ignoreCodes: [1343] },
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(@testing-library)/)'],
};

export default config;
