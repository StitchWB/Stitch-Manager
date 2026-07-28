# Auto-generated TypeScript Types

This directory contains TypeScript types automatically generated from Pydantic models in the Python backend.

## Files

- `types.ts` - TypeScript interfaces for all Pydantic request/response models
- `schemas.json` - JSON Schema representation (intermediate file, gitignored)

## Regenerating Types

When you modify Pydantic models in the Python backend, regenerate the TypeScript types:

```bash
npm run generate:ts-types
```

This will:
1. Collect all Pydantic models from `python/stitch_backend/domains/*/schemas.py`
2. Generate JSON schemas
3. Convert to TypeScript interfaces in `types.ts`

## Usage

Import types in your TypeScript code:

```typescript
import type { RefreshAccountRequest } from '@/api/types';

export async function refreshAccount(params: RefreshAccountRequest) {
  return safeInvoke('refresh_account', params);
}
```

## Benefits

- **Type safety**: TypeScript catches parameter mismatches at compile time
- **Single source of truth**: Pydantic models are the source, TypeScript is generated
- **No runtime errors**: No more `Field required` errors from backend validation

## Adding New Models

To include a new Pydantic model in the generation:

1. Add the model to `scripts/generate_ts_types.py` in the `collect_models()` function
2. Run `npm run generate:ts-types`
3. Commit the updated `types.ts`

## How It Works

The generation script:
1. Imports all Pydantic models from backend domains
2. Uses `model.model_json_schema()` to get JSON Schema
3. Resolves all `$ref` by inlining type definitions
4. Converts JSON Schema to TypeScript interfaces

See `scripts/generate_ts_types.py` for implementation details.
