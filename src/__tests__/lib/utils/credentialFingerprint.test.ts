import { describe, it, expect } from '@jest/globals';

import { computeCredentialFingerprint } from '@/lib/utils/credentialFingerprint';

describe('computeCredentialFingerprint', () => {
  it('pins the backend sha256 hexdigest for a known vector', async () => {
    await expect(computeCredentialFingerprint('ep-1', 'sk-test')).resolves.toBe(
      'dbecca283585f0e8516020ca81d51ec019ea160d3ab9760b2f8c9019e0917527',
    );
  });

  it('changes when the endpoint id changes', async () => {
    const first = await computeCredentialFingerprint('ep-1', 'sk-test');
    const second = await computeCredentialFingerprint('ep-2', 'sk-test');

    expect(second).not.toBe(first);
  });
});
