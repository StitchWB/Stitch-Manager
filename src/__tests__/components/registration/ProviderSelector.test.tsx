import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderSelector } from '../../../components/registration/ProviderSelector';

describe('ProviderSelector', () => {
  it('shows openai when it is allowed', async () => {
    const user = userEvent.setup();
    render(
      <ProviderSelector
        activeProvider="kiro"
        onProviderChange={jest.fn()}
        allowedProviders={['kiro', 'aws', 'windsurf', 'trae', 'github', 'openai']}
      />
    );

    expect(screen.getByText('Kiro')).toBeTruthy();
    expect(screen.getByText('Windsurf')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'AI' }));
    // Allow effect-driven category switch to settle
    expect(await screen.findByText('OpenAI')).toBeTruthy();
  });
});
