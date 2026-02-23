import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { IdentityTab } from '../../../components/registration/IdentityTab';

jest.mock('../../../components/ui/IdentitySystemCard', () => ({
  IdentitySystemCard: () => <div>IdentitySystemCard</div>,
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
    expect(screen.getByText('OpenAI requirements')).toBeTruthy();
    expect(screen.getByText(/Email verification required/i)).toBeTruthy();
  });

  it('renders AWS special panel when provider=aws', () => {
    render(<IdentityTab provider="aws" {...baseProps} />);
    expect(screen.getByText('AWS Builder ID')).toBeTruthy();
  });
});
