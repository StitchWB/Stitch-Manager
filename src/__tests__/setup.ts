/**
 * Jest test setup file
 * Runs before each test suite
 */

import '@testing-library/jest-dom';

// jsdom does not ship with a `fetch` implementation. Polyfill it so tests that
// exercise code paths using fetch (e.g. Backend command wrappers) do not throw
// "ReferenceError: fetch is not defined".
if (typeof globalThis.fetch === 'undefined') {
  (globalThis as any).fetch = jest.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
    clone() { return this; },
    headers: new Headers(),
  }));
}

// React 18: ensure act() environment is enabled for Testing Library.
// This prevents noisy warnings about updates not wrapped in act(...)
// when using userEvent and async state updates.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: () => `test-uuid-${Math.random().toString(16).slice(2)}`,
    },
    configurable: true,
  });
} else if (typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => `test-uuid-${Math.random().toString(16).slice(2)}`,
    configurable: true,
  });
}

// Polyfill fetch for jsdom — jsdom does not ship fetch, but some components
// (e.g. AiProviders) call it indirectly. The mock returns an empty success
// response; individual tests can override it with jest.spyOn(globalThis, 'fetch').
if (typeof globalThis.fetch === 'undefined') {
  (globalThis as any).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  }));
}

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
