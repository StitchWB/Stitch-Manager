import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProviderSelector } from '../../../components/registration/ProviderSelector';
import type { ProviderInfo } from '../../../lib/backend';

const mkProvider = (
  id: string,
  displayName: string,
  requiresMachineId = false,
): ProviderInfo => ({ id, displayName, requiresMachineId });

describe('ProviderSelector', () => {
  it('shows active provider displayName in collapsed trigger', () => {
    const providers = [mkProvider('kiro_v2', 'Kiro v2', true)];
    render(
      <ProviderSelector
        activeProvider="kiro_v2"
        onProviderChange={jest.fn()}
        providers={providers}
      />,
    );

    expect(screen.getByText('Kiro v2')).toBeTruthy();
  });

  it('shows requiresMachineId badge for providers that require it', async () => {
    const user = userEvent.setup();
    const providers = [
      mkProvider('kiro_v2', 'Kiro v2', true),
      mkProvider('aws', 'AWS', false),
    ];
    render(
      <ProviderSelector
        activeProvider="kiro_v2"
        onProviderChange={jest.fn()}
        providers={providers}
      />,
    );

    // Active provider with requiresMachineId shows the badge in the trigger.
    expect(screen.getByText('Machine ID')).toBeTruthy();

    // Expand the dropdown to see all providers.
    await user.click(screen.getByRole('button', { expanded: false }));

    // Both provider displayNames should be visible.
    // The active provider appears in both the trigger and the grid, so use
    // getAllByText for it.
    expect(screen.getAllByText('Kiro v2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('AWS')).toBeTruthy();
  });

  it('renders all provider displayNames when expanded', async () => {
    const user = userEvent.setup();
    const providers = [
      mkProvider('kiro_v2', 'Kiro v2'),
      mkProvider('aws', 'AWS'),
      mkProvider('openai', 'OpenAI'),
    ];
    render(
      <ProviderSelector
        activeProvider="kiro_v2"
        onProviderChange={jest.fn()}
        providers={providers}
      />,
    );

    await user.click(screen.getByRole('button', { expanded: false }));

    // The active provider appears in both the trigger and the grid.
    expect(screen.getAllByText('Kiro v2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('AWS')).toBeTruthy();
    expect(screen.getByText('OpenAI')).toBeTruthy();
  });

  it('calls onProviderChange when a provider is selected', async () => {
    const user = userEvent.setup();
    const onProviderChange = jest.fn();
    const providers = [
      mkProvider('kiro_v2', 'Kiro v2'),
      mkProvider('aws', 'AWS'),
    ];
    render(
      <ProviderSelector
        activeProvider="kiro_v2"
        onProviderChange={onProviderChange}
        providers={providers}
      />,
    );

    await user.click(screen.getByRole('button', { expanded: false }));
    await user.click(screen.getByText('AWS'));

    expect(onProviderChange).toHaveBeenCalledWith('aws');
  });
});
