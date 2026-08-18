# providering

Reusable provider/integration contracts for AI-tool setup flows.

## Goal

Make provider-profile and IDE integration logic portable across projects.

## Exports

- `ProviderProfile`, `ProviderKey` (contracts)
- `PROVIDER_PROFILES`, `DEFAULT_PROVIDER_PROFILE_KEY`, `getProviderProfile`
- `openAiLikeAdapter`
- `buildManualEnvPayload(endpoint, providerKey)`

## Typical usage

```ts
import {
  PROVIDER_PROFILES,
  DEFAULT_PROVIDER_PROFILE_KEY,
  buildManualEnvPayload,
  getProviderProfile,
} from '@/lib/providering';

const key = DEFAULT_PROVIDER_PROFILE_KEY;
const profile = getProviderProfile(key);
const env = buildManualEnvPayload('http://127.0.0.1:8317/v1', profile.key);
```

## Porting to another project

1. Copy `src/lib/providering/`
2. Add project-specific provider profiles in `profiles.ts`
3. Add adapters for non OpenAI-like tools in `adapters/`
4. Use `buildManualEnvPayload` (or call adapters directly)
