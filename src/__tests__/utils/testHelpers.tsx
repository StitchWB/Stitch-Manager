/**
 * Test helper utilities for React components
 */

import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';
import { BrowserRouter } from 'react-router-dom';

/**
 * Custom render function that wraps components with necessary providers
 */
export function renderWithRouter(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, {
    wrapper: ({ children }) => <BrowserRouter>{children}</BrowserRouter>,
    ...options,
  });
}

/**
 * Wait for a condition to be true
 * @param condition - Function that returns true when condition is met
 * @param timeout - Maximum time to wait in ms
 * @param interval - Check interval in ms
 */
export async function waitForCondition(
  condition: () => boolean,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

/**
 * Create a mock file for file input testing
 */
export function createMockFile(
  name: string,
  content: string,
  type = 'text/plain'
): File {
  const blob = new Blob([content], { type });
  return new File([blob], name, { type });
}

/**
 * Simulate user typing with delays
 */
export async function typeWithDelay(
  element: HTMLElement,
  text: string,
  delay = 50
): Promise<void> {
  for (const char of text) {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: char }));
    element.dispatchEvent(new KeyboardEvent('keypress', { key: char }));
    (element as HTMLInputElement).value += char;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { key: char }));
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

/**
 * Mock localStorage for tests
 */
export function mockLocalStorage() {
  const store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach(key => delete store[key]);
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] || null,
  };
}

/**
 * Setup localStorage mock before tests
 */
export function setupLocalStorageMock() {
  const mockStorage = mockLocalStorage();
  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    writable: true,
  });
  return mockStorage;
}
