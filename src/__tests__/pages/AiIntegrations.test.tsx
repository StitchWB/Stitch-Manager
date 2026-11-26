import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AiIntegrations } from '../../pages/AiIntegrations';
import { getLocalChatToken } from '../../lib/backend/modules/aiProxy';
import { modelSyncStatus } from '../../lib/backend/modules/modelSync';
import { useAiProvidersController } from '../../pages/hooks/useAiProvidersController';

jest.mock('../../lib/backend/modules/aiProxy', () => ({
  getLocalChatToken: jest.fn(),
}));

jest.mock('../../lib/backend/modules/modelSync', () => ({
  modelSyncStatus: jest.fn(),
}));

jest.mock('../../pages/hooks/useAiProvidersController', () => ({
  useAiProvidersController: jest.fn(),
}));

jest.mock('../../components/ai-proxy/VellyConnectionCard', () => ({
  VellyConnectionCard: () => null,
}));

jest.mock('../../components/ai-proxy/modals/AiTransferModal', () => ({
  AiTransferModal: () => null,
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const controller = useAiProvidersController as jest.MockedFunction<typeof useAiProvidersController>;
const token = getLocalChatToken as jest.MockedFunction<typeof getLocalChatToken>;
const syncStatus = modelSyncStatus as jest.MockedFunction<typeof modelSyncStatus>;

function controllerFixture(proxyRunning: boolean) {
  return {
    baseUrl: 'http://127.0.0.1:5580',
    proxyStatus: { running: proxyRunning },
    authScan: null,
    authScanLoading: false,
    importPayload: '',
    setImportPayload: jest.fn(),
    importValidation: null,
    importLoading: false,
    scanAuthFiles: jest.fn(),
    handlePrepareImportFromScan: jest.fn(),
    handleImportPayload: jest.fn(),
    handleImportAllFromScan: jest.fn(),
    exportFormat: 'json',
    setExportFormat: jest.fn(),
    exportIncludeSecrets: false,
    setExportIncludeSecrets: jest.fn(),
    exportPayload: '',
    exportLoading: false,
    handleGenerateExport: jest.fn(),
    downloadText: jest.fn(),
    buildExportFileName: jest.fn(() => 'export.json'),
    effectiveExportIncludeSecrets: false,
  } as unknown as ReturnType<typeof useAiProvidersController>;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AiIntegrations />
    </MemoryRouter>,
  );
}

describe('AiIntegrations gateway connection card', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    token.mockResolvedValue('local-token');
    syncStatus.mockResolvedValue({
      ok: true,
      gatewayRunning: true,
      baseUrl: 'http://127.0.0.1:25584/v1',
    });
  });

  it('shows the working AI Gateway endpoint and hides legacy proxy when stopped', async () => {
    controller.mockReturnValue(controllerFixture(false));
    renderPage();

    expect(await screen.findByDisplayValue('http://127.0.0.1:25584/v1')).toBeTruthy();
    expect(screen.getByDisplayValue('local-token')).toBeTruthy();
    expect(screen.queryByText('Legacy AI Proxy')).toBeNull();
    expect(screen.queryByDisplayValue('http://127.0.0.1:5580')).toBeNull();
    expect(screen.getByText(/Model Sync creates separate install keys/)).toBeTruthy();
  });

  it('labels the legacy proxy separately only when it is actually running', async () => {
    controller.mockReturnValue(controllerFixture(true));
    renderPage();

    expect(await screen.findByDisplayValue('http://127.0.0.1:25584/v1')).toBeTruthy();
    expect(screen.getByText('Legacy AI Proxy')).toBeTruthy();
    expect(screen.getByDisplayValue('http://127.0.0.1:5580')).toBeTruthy();
  });
});
