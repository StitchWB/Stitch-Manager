/**
 * Jest test setup file
 * Runs before each test suite
 */

import '@testing-library/jest-dom';

// React 18: ensure act() environment is enabled for Testing Library.
// This prevents noisy warnings about updates not wrapped in act(...)
// when using userEvent and async state updates.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Mock Tauri API
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: {},
  writable: true,
});

// Suppress console errors in tests (optional)
const originalError = console.error;
const originalWarn = console.warn;
beforeAll(() => {
  console.error = (...args: any[]) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Not implemented') || args[0].includes('not wrapped in act'))
    ) {
      return;
    }
    originalError.call(console, ...args);
  };

  console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('React Router Future Flag Warning')) {
      return;
    }
    originalWarn.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
  console.warn = originalWarn;
});
