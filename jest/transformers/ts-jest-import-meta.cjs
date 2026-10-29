'use strict';

/**
 * Custom Jest transformer that:
 *   1. Replaces `import.meta.env.*` (and bare `import.meta`) with a plain object
 *      literal in the raw source text, BEFORE TypeScript ever parses it. This
 *      avoids the CommonJS-mode "Cannot use 'import.meta' outside a module"
 *      SyntaxError that Jest throws on Vite-style source files.
 *   2. Delegates the patched source to ts-jest for full TypeScript compilation.
 *
 * Exposed via `createTransformer(config)` so Jest forwards the tsconfig options
 * declared in jest.config.mjs (jsx, paths, module, etc.) straight to ts-jest.
 *
 * This wrapper approach is preferred over ts-jest `astTransformers` (the parse
 * error happens before any AST transform runs) and over babel-jest (whose
 * jest.mock() hoisting rules break mocks referencing outer-scope variables).
 */

// ts-jest v29 exposes createTransformer on the module's default export.
const tsJest = require('ts-jest');
const createTsJestTransformer =
  (tsJest.default && tsJest.default.createTransformer) || tsJest.createTransformer;

// Sentinel object used to replace import.meta in all positions.
// Keeps the shape flat so destructuring like `const { DEV } = import.meta.env`
// and property access like `import.meta.env.DEV` both resolve correctly.
const META_ENV_OBJ = '({"DEV":false,"PROD":true,"MODE":"test","BASE_URL":"/","SSR":false})';
const META_OBJ     = '({"env":{"DEV":false,"PROD":true,"MODE":"test","BASE_URL":"/","SSR":false}})';

/** Replace all `import.meta` occurrences before TS compilation. */
function patchSource(source) {
  // Replace `import.meta.env` first (more specific), then bare `import.meta`.
  return source
    .replace(/import\.meta\.env/g, META_ENV_OBJ)
    .replace(/import\.meta/g,      META_OBJ);
}

module.exports = {
  createTransformer(config) {
    const inner = createTsJestTransformer(config);
    return {
      process(sourceText, sourcePath, options) {
        return inner.process(patchSource(sourceText), sourcePath, options);
      },
      processAsync(sourceText, sourcePath, options) {
        return inner.processAsync(patchSource(sourceText), sourcePath, options);
      },
      getCacheKey(sourceText, sourcePath, options) {
        return inner.getCacheKey(patchSource(sourceText), sourcePath, options);
      },
      getCacheKeyAsync(sourceText, sourcePath, options) {
        return inner.getCacheKeyAsync(patchSource(sourceText), sourcePath, options);
      },
    };
  },
};
