import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { IdentityTab } from '../../../components/registration/IdentityTab';

jest.mock('../../../components/ui/IdentitySystemCard', () => ({
  // eslint-disable-next-line i18next/no-literal-string
  IdentitySystemCard: () => <div>IdentitySystemCard</div>,
}));

// Mock the custom i18n module so Jest doesn't try to load locale files (which
// import from src/lib/locales/ru and fail in CommonJS mode).
// Returns the last dot-separated segment of the key as a human-readable stub.
jest.mock('../../../lib/i18n', () => ({
  t: (key: string) => key.split('.').pop() ?? key,
}));

describe('IdentityTab', () => {
  const baseProps: any = {
    identityConfig: {},
    onConfigChange: jest.fn(),
    onTest: jest.fn(async () => true),
    disabled: false,
    saveStatus: 'idle',
    passwordSet: false,
    gmailAppPasswordSet: false,
    onTestAddyio: jest.fn(async () => undefined),
    isTestingAddyio: false,
    addyioConnectionStatus: 'idle',
    addyioConnectionMessage: '',
    addyioAccountInfo: null,
    addyioDomains: [],
  };

  it('shows OpenAI requirement callout when provider=openai', () => {
    render(<IdentityTab provider="openai" {...baseProps} />);
    // PROVIDER_REQUIREMENT_HINTS.openai.title is a plain string 'Требования OpenAI'
    // (not translated via t()), so it renders as-is.
    expect(screen.getByText('Требования OpenAI')).toBeTruthy();
  });

  it('renders AWS special panel when provider=aws', () => {
    render(<IdentityTab provider="aws" {...baseProps} />);
    // t('autoReg.identity_tab.aws_builder_id') → stub returns last segment: 'aws_builder_id'
    expect(screen.getByText('aws_builder_id')).toBeTruthy();
  });
});
