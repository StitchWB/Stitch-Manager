import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import ModelSync from '@/pages/ModelSync';
import * as modelSyncModule from '@/lib/backend/modules/modelSync';

jest.mock('@/components/layout/Header', () => ({
  __esModule: true,
  default: () => <div data-testid="header" />,
}));

jest.mock('@/lib/backend/modules/modelSync', () => {
  const actual = jest.requireActual('@/lib/backend/modules/modelSync') as object;
  return {
    ...actual,
    modelSyncCatalog: jest.fn(),
    modelSyncStatus: jest.fn(),
    modelSyncPreview: jest.fn(),
    modelSyncApply: jest.fn(),
    modelSyncRestore: jest.fn(),
  };
});

const backend = modelSyncModule as jest.Mocked<typeof modelSyncModule>;

const catalogResponse = {
  ok: true,
  count: 3,
  models: [
    {
      id: 'alpha',
      name: 'Alpha Model',
      contextTokens: 128000,
      outputTokens: 8192,
      inputModalities: ['text'],
      outputModalities: ['text'],
      tools: true,
      reasoning: null,
    },
    {
      id: 'beta',
      name: 'Beta Vision',
      contextTokens: 64000,
      outputTokens: 4096,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      tools: false,
      reasoning: true,
    },
    {
      id: 'gamma',
      name: 'Gamma Small',
      contextTokens: 32000,
      outputTokens: 2048,
      inputModalities: ['text'],
      outputModalities: ['text'],
      tools: true,
      reasoning: null,
    },
  ],
};

function statusResponse(schema: 'v1' | 'v2' | 'unknown' = 'v1') {
  return {
    ok: true,
    gatewayRunning: true,
    baseUrl: 'http://127.0.0.1:25584/v1',
    opencode: {
      detectedVersion: { version: schema, source: 'binary', raw: schema === 'v2' ? '2.1.0' : '1.4.0' },
      writeTarget: '/home/test/.config/opencode/opencode.json',
      writeTargetExists: true,
      secondaryPath: null,
      configJsonPresent: false,
      warnings: [],
      stitchModels: ['alpha'],
      sha256: 'abc',
      credential: { status: 'credential-match', detail: 'stored credential matches current token' },
    },
    omp: {
      profiles: [
        {
          name: 'default',
          agentDir: '/home/test/.omp/agent',
          exists: true,
          modelsPath: '/home/test/.omp/agent/models.yml',
          configPath: '/home/test/.omp/agent/config.yml',
          isDefault: true,
          stitchModels: ['alpha'],
        },
        {
          name: 'work',
          agentDir: '/home/test/.omp/profiles/work/agent',
          exists: true,
          modelsPath: '/home/test/.omp/profiles/work/agent/models.yml',
          configPath: '/home/test/.omp/profiles/work/agent/config.yml',
          isDefault: false,
          stitchModels: ['beta'],
        },
      ],
      profileHint: null,
    },
  };
}

function previewResponse() {
  return {
    ok: true,
    errors: [],
    warnings: [],
    schema: 'v1',
    detectedVersion: { version: 'v1', source: 'binary', raw: '1.4.0' },
    modelDiffs: {
      opencode: { added: ['beta'], removed: [], updated: [], unchanged: ['alpha'] },
      omp: { added: ['beta'], removed: [], updated: [], unchanged: ['alpha'] },
    },
    unknownModelIds: [],
    files: [
      {
        path: '/home/test/.config/opencode/opencode.json',
        kind: 'opencode-primary',
        target: 'opencode',
        exists: true,
        sha256: 'abc',
        changed: true,
        diff: '@@ -1 +1 @@\n-  "apiKey": "old"\n+  "apiKey": "sk-live-secret"\n',
      },
    ],
    expectedSha256: { '/home/test/.config/opencode/opencode.json': 'abc' },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/ai/model-sync']}>
      <Routes>
        <Route path="/ai/model-sync" element={<ModelSync />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderLoaded(schema?: 'v1' | 'v2' | 'unknown') {
  backend.modelSyncStatus.mockResolvedValue(statusResponse(schema) as any);
  const rendered = renderPage();
  expect(await screen.findByTestId('model-sync-gateway-card')).toBeTruthy();
  await screen.findByTestId('model-sync-model-row-alpha');
  return rendered;
}

async function clickPreview() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('model-sync-preview-button'));
  });
  await waitFor(() => expect(backend.modelSyncPreview).toHaveBeenCalled());
}

describe('ModelSync page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    backend.modelSyncCatalog.mockResolvedValue(catalogResponse as any);
    backend.modelSyncPreview.mockResolvedValue(previewResponse() as any);
    backend.modelSyncApply.mockResolvedValue({ ok: true, files: [], warnings: [] } as any);
    backend.modelSyncRestore.mockResolvedValue({ ok: true, files: [] } as any);
  });

  it('renders the gateway card and both target cards', async () => {
    await renderLoaded();

    expect(screen.getByTestId('model-sync-gateway-card')).toBeTruthy();
    expect(screen.getByTestId('model-sync-opencode-card')).toBeTruthy();
    expect(screen.getByTestId('model-sync-omp-card')).toBeTruthy();
    expect(screen.getByText('http://127.0.0.1:25584/v1')).toBeTruthy();
  });

  it('selection changes are reflected in the preview payload', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByLabelText('beta'));
    await clickPreview();

    const params = backend.modelSyncPreview.mock.calls.at(-1)?.[0] as any;
    expect(params.models).toEqual(['alpha']);
    expect(params.targets).toEqual(['opencode', 'omp']);
  });

  it('disables the small model picker when the effective schema is v2', async () => {
    await renderLoaded('v2');

    const smallModel = screen.getByTestId('opencode-small-model-select') as HTMLSelectElement;
    expect(smallModel.disabled).toBe(true);
  });

  it('enables the small model picker for v1 and includes it in the payload', async () => {
    await renderLoaded('v1');

    const smallModel = screen.getByTestId('opencode-small-model-select') as HTMLSelectElement;
    expect(smallModel.disabled).toBe(false);
    fireEvent.change(smallModel, { target: { value: 'stitch/beta' } });
    await clickPreview();

    const params = backend.modelSyncPreview.mock.calls.at(-1)?.[0] as any;
    expect(params.smallModel).toBe('stitch/beta');
  });

  it('initializes the small model picker from the status response', async () => {
    const status = statusResponse('v1') as any;
    status.opencode.smallModel = 'stitch/alpha';
    backend.modelSyncStatus.mockResolvedValue(status);
    renderPage();
    await screen.findByTestId('model-sync-model-row-alpha');

    const smallModel = screen.getByTestId('opencode-small-model-select') as HTMLSelectElement;
    expect(smallModel.value).toBe('stitch/alpha');
    await clickPreview();

    const params = backend.modelSyncPreview.mock.calls.at(-1)?.[0] as any;
    expect(params.smallModel).toBe('stitch/alpha');
  });

  it('displays the omp binary path and version when reported', async () => {
    const status = statusResponse('v1') as any;
    status.omp.binaryPath = '/usr/local/bin/omp';
    status.omp.version = '0.14.2';
    backend.modelSyncStatus.mockResolvedValue(status);
    renderPage();
    await screen.findByTestId('model-sync-model-row-alpha');

    expect(screen.getByTestId('omp-binary-path').textContent).toBe('/usr/local/bin/omp');
    expect(screen.getByTestId('omp-binary-version').textContent).toBe('0.14.2');
  });

  it('keeps apply disabled before a fresh preview', async () => {
    await renderLoaded();

    const apply = screen.getByTestId('model-sync-apply-button') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(backend.modelSyncPreview).not.toHaveBeenCalled();
  });

  it('never renders the gateway token contained in a malformed diff', async () => {
    const rendered = await renderLoaded();
    await clickPreview();

    await screen.findByTestId('model-sync-preview-panel');
    await waitFor(() => {
      expect(rendered.container.textContent).not.toContain('sk-live-secret');
      expect(rendered.container.textContent).toContain('********');
    });
  });

  it('shows the structured 409 conflict state and forces a fresh preview', async () => {
    backend.modelSyncApply.mockResolvedValue({
      ok: false,
      error: 'conflict',
      status: 409,
      mismatches: [
        {
          path: '/home/test/.config/opencode/opencode.json',
          error: 'sha256 mismatch — file changed since preview',
          expected: 'abc',
          actual: 'def',
        },
      ],
    } as any);
    await renderLoaded();
    await clickPreview();

    const apply = screen.getByTestId('model-sync-apply-button') as HTMLButtonElement;
    await waitFor(() => expect(apply.disabled).toBe(false));
    await act(async () => {
      fireEvent.click(apply);
    });

    expect(await screen.findByTestId('model-sync-conflict')).toBeTruthy();
    expect(screen.getAllByText('/home/test/.config/opencode/opencode.json').length).toBeGreaterThan(0);
    expect((screen.getByTestId('model-sync-apply-button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('switches the omp profile into the preview payload', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByTestId('omp-profile-select'), { target: { value: 'work' } });
    await clickPreview();

    const params = backend.modelSyncPreview.mock.calls.at(-1)?.[0] as any;
    expect(params.ompProfile).toBe('work');
  });

  it('renders both opencode binaries when v1 and v2 are detected', async () => {
    const status = statusResponse('v1') as any;
    status.opencode.binaries = {
      opencode: { version: '1.4.0', path: '/usr/local/bin/opencode' },
      opencode2: { version: '2.1.0', path: '/usr/local/bin/opencode2' },
    };
    backend.modelSyncStatus.mockResolvedValue(status);
    renderPage();
    await screen.findByTestId('model-sync-model-row-alpha');

    const v1Badge = screen.getByTestId('opencode-binary-v1-badge');
    const v2Badge = screen.getByTestId('opencode-binary-v2-badge');
    expect(v1Badge.textContent).toContain('1.4.0');
    expect(v2Badge.textContent).toContain('2.1.0');
  });

  it('renders only the v2 binary badge when only opencode2 is installed', async () => {
    const status = statusResponse('v2') as any;
    status.opencode.binaries = {
      opencode2: { version: '2.1.0', path: '/usr/local/bin/opencode2' },
    };
    backend.modelSyncStatus.mockResolvedValue(status);
    renderPage();
    await screen.findByTestId('model-sync-model-row-alpha');

    expect(screen.queryByTestId('opencode-binary-v1-badge')).toBeNull();
    expect(screen.getByTestId('opencode-binary-v2-badge').textContent).toContain('2.1.0');
  });

  it('degrades gracefully when binaries are absent — no binary badges', async () => {
    await renderLoaded();

    expect(screen.queryByTestId('opencode-binary-v1-badge')).toBeNull();
    expect(screen.queryByTestId('opencode-binary-v2-badge')).toBeNull();
    // legacy fallback badge still renders the detected version
    expect(screen.getByTestId('opencode-binary-detected-badge')).toBeTruthy();
  });

  it('renders the security section with key state, fingerprint and legacy warning', async () => {
    const status = statusResponse('v1') as any;
    status.security = {
      keys: {
        opencode: {
          state: 'active',
          keyId: 'key-1',
          fingerprint: 'fp:aa:bb',
          enabled: true,
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          lastUsedAt: new Date(Date.now() - 3600000).toISOString(),
          configuredSecretState: 'configured',
          legacyLocalTokenDetected: true,
        },
        omp: {
          state: 'missing',
          legacyLocalTokenDetected: false,
        },
      },
    };
    backend.modelSyncStatus.mockResolvedValue(status);
    renderPage();
    await screen.findByTestId('model-sync-model-row-alpha');

    expect(screen.getByTestId('model-sync-security-section')).toBeTruthy();
    expect(screen.getByTestId('model-sync-security-key-opencode')).toBeTruthy();
    expect(screen.getByTestId('model-sync-security-key-omp')).toBeTruthy();
    expect(screen.getByTestId('security-fingerprint-opencode').textContent).toBe('fp:aa:bb');
    expect(screen.getByTestId('security-legacy-warning-opencode')).toBeTruthy();
    expect(screen.queryByTestId('security-legacy-warning-omp')).toBeNull();
  });

  it('hides the security section entirely when the backend reports no security info', async () => {
    await renderLoaded();

    expect(screen.queryByTestId('model-sync-security-section')).toBeNull();
  });

  it('renders the key plan inside the preview when reported', async () => {
    const preview = previewResponse() as any;
    preview.keyPlan = {
      opencode: { action: 'create', fingerprint: 'fp:cc:dd', legacyLocalTokenDetected: true },
      omp: { action: 'reuse', fingerprint: 'fp:ee:ff' },
    };
    backend.modelSyncPreview.mockResolvedValue(preview);
    await renderLoaded();
    await clickPreview();

    expect(await screen.findByTestId('model-sync-key-plan')).toBeTruthy();
    expect(screen.getByTestId('key-plan-opencode').textContent).toContain('fp:cc:dd');
    expect(screen.getByTestId('key-plan-omp')).toBeTruthy();
  });

  it('renders no key plan block when the preview omits it', async () => {
    await renderLoaded();
    await clickPreview();

    await screen.findByTestId('model-sync-preview-panel');
    expect(screen.queryByTestId('model-sync-key-plan')).toBeNull();
  });
});
