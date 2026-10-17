import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { SubmitPluginModal } from '@/components/marketplace/SubmitPluginModal';

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

const submitPluginMock = jest.fn();
const previewReleaseMock = jest.fn();

jest.mock('@/lib/backend/modules/submissions', () => ({
  submitPlugin: (...args: unknown[]) => submitPluginMock(...(args as [])),
  previewRelease: (...args: unknown[]) => previewReleaseMock(...(args as [])),
}));

const SHA = 'a'.repeat(64);

function renderModal() {
  return render(
    <SubmitPluginModal isOpen onClose={jest.fn()} onSubmitted={jest.fn()} />,
  );
}

async function fillRequiredFields() {
  await userEvent.type(screen.getByLabelText('marketplace.submit.pluginId'), 'my-plugin');
  await userEvent.type(screen.getByLabelText('marketplace.submit.version'), '1.0.0');
  await userEvent.type(
    screen.getByLabelText('marketplace.submit.releaseUrl'),
    'https://example.com/pkg.tar.gz',
  );
  await userEvent.type(screen.getByLabelText('marketplace.submit.sha256'), SHA);
}

describe('SubmitPluginModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    submitPluginMock.mockResolvedValue({ success: true, submission_id: 7 });
  });

  it('fetch success prefills sha256 and empty pluginId/version', async () => {
    previewReleaseMock.mockResolvedValue({
      success: true,
      sha256: SHA,
      manifest_id: 'manifest-plugin',
      manifest_version: '1.2.3',
    });
    renderModal();

    await userEvent.type(
      screen.getByLabelText('marketplace.submit.releaseUrl'),
      'https://example.com/pkg.tar.gz',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'marketplace.submit.fetchSha' }),
    );

    expect(previewReleaseMock).toHaveBeenCalledWith('https://example.com/pkg.tar.gz');
    await waitFor(() =>
      expect(screen.getByLabelText('marketplace.submit.sha256')).toHaveValue(SHA),
    );
    expect(screen.getByLabelText('marketplace.submit.pluginId')).toHaveValue('manifest-plugin');
    expect(screen.getByLabelText('marketplace.submit.version')).toHaveValue('1.2.3');
  });

  it('fetch success does not overwrite non-empty pluginId/version', async () => {
    previewReleaseMock.mockResolvedValue({
      success: true,
      sha256: SHA,
      manifest_id: 'manifest-plugin',
      manifest_version: '9.9.9',
    });
    renderModal();

    await userEvent.type(screen.getByLabelText('marketplace.submit.pluginId'), 'custom');
    await userEvent.type(screen.getByLabelText('marketplace.submit.version'), '0.0.1');
    await userEvent.type(
      screen.getByLabelText('marketplace.submit.releaseUrl'),
      'https://example.com/pkg.zip',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'marketplace.submit.fetchSha' }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('marketplace.submit.sha256')).toHaveValue(SHA),
    );
    expect(screen.getByLabelText('marketplace.submit.pluginId')).toHaveValue('custom');
    expect(screen.getByLabelText('marketplace.submit.version')).toHaveValue('0.0.1');
  });

  it('fetch failure (success: false) toasts fetchShaFailed and leaves fields alone', async () => {
    previewReleaseMock.mockResolvedValue({ success: false, error: 'boom' });
    renderModal();

    await userEvent.type(
      screen.getByLabelText('marketplace.submit.releaseUrl'),
      'https://example.com/pkg.tar.gz',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'marketplace.submit.fetchSha' }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('marketplace.submit.fetchShaFailed'),
    );
    expect(screen.getByLabelText('marketplace.submit.sha256')).toHaveValue('');
    expect(screen.getByLabelText('marketplace.submit.pluginId')).toHaveValue('');
  });

  it('fetch rejection toasts fetchShaFailed', async () => {
    previewReleaseMock.mockRejectedValue(new Error('network down'));
    renderModal();

    await userEvent.type(
      screen.getByLabelText('marketplace.submit.releaseUrl'),
      'https://example.com/pkg.tar.gz',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'marketplace.submit.fetchSha' }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('marketplace.submit.fetchShaFailed'),
    );
  });

  it('fetch with an empty URL surfaces requiredRelease and skips the backend', async () => {
    renderModal();

    await userEvent.click(
      screen.getByRole('button', { name: 'marketplace.submit.fetchSha' }),
    );

    expect(screen.getByText('marketplace.submit.requiredRelease')).toBeTruthy();
    expect(previewReleaseMock).not.toHaveBeenCalled();
  });

  it('an invalid domain tag blocks submit with domainInvalid', async () => {
    renderModal();
    await fillRequiredFields();

    await userEvent.type(
      screen.getByPlaceholderText('marketplace.submit.domainsPlaceholder'),
      'bad_domain{Enter}',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'marketplace.submit.submit' }),
    );

    expect(screen.getByText('marketplace.submit.domainInvalid')).toBeTruthy();
    expect(submitPluginMock).not.toHaveBeenCalled();
  });

  it('submit sends declared_domains as a tag array', async () => {
    renderModal();
    await fillRequiredFields();

    const domainsInput = screen.getByPlaceholderText(
      'marketplace.submit.domainsPlaceholder',
    );
    await userEvent.type(domainsInput, 'a.com{Enter}');
    await userEvent.type(domainsInput, 'b.com{Enter}');
    await userEvent.click(
      screen.getByRole('button', { name: 'marketplace.submit.submit' }),
    );

    await waitFor(() => expect(submitPluginMock).toHaveBeenCalledTimes(1));
    expect(submitPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({ declared_domains: ['a.com', 'b.com'] }),
    );
  });
});
