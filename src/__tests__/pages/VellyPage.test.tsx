import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import VellyPage from '../../pages/VellyPage';
import { safeInvoke } from '../../lib/backend/core/invoke';

jest.mock('../../lib/backend/core/invoke', () => ({ safeInvoke: jest.fn(), setAuthExpiredHandler: jest.fn() }));
const mockInvoke = safeInvoke as jest.Mock;
const config = { profile: 'C:/Fixture/Velly', node: 'C:/Fixture/node.exe', port: 38761, opencodePath: 'C:/Fixture/opencode.json', accessTokenPresent: true, deviceKeyPresent: true };
const rows = [
  { id: 'anthropic/sonnet', name: 'Sonnet', context: 1000000, historicallyVerified: true, status: 'unknown' },
  { id: 'other/model', name: 'Other', context: 131072, historicallyVerified: false, status: 'unknown' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockInvoke.mockImplementation(async (command: string) => {
    if (command.endsWith('get_status')) return { running: true, rows };
    if (command.endsWith('get_connection')) return config;
    if (command.endsWith('export_secrets')) return { path: 'C:/Fixture/exports/velly.json', fields: ['access_token'] };
    return {};
  });
});

function open() { render(<MemoryRouter><VellyPage /></MemoryRouter>); }

it('shows searchable models without setup fields and never probes on load', async () => {
  open();
  expect(await screen.findByText('Sonnet')).toBeTruthy();
  expect(screen.queryByLabelText('Профиль Velly')).toBeNull();
  expect(screen.queryByText('Other')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Все 2' }));
  expect(screen.getByText('Other')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Поиск моделей' }), { target: { value: 'other' } });
  expect(screen.queryByText('Sonnet')).toBeNull();
  expect(mockInvoke.mock.calls.some(([command]) => command.includes('probe_model'))).toBe(false);
});

it('exports an API token only after an explicit click and shows the path', async () => {
  open();
  await screen.findByText('Sonnet');
  fireEvent.click(screen.getByRole('tab', { name: 'Токены' }));
  expect(screen.getByText('Токен API')).toBeTruthy();
  expect(screen.getByText('Ключ устройства')).toBeTruthy();
  expect(mockInvoke.mock.calls.some(([command]) => command.includes('export_secrets'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить токен в файл' }));
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('plugin.stitch-velly.export_secrets', { includeDeviceKey: false }));
  expect(await screen.findByText('C:/Fixture/exports/velly.json')).toBeTruthy();
});

it('prefills connection paths with detected values instead of empty fields', async () => {
  open();
  await screen.findByText('Sonnet');
  fireEvent.click(screen.getByRole('tab', { name: 'Подключение' }));
  expect(screen.getByLabelText('Конфигурация')).toHaveProperty('value', config.opencodePath);
  expect(screen.getByLabelText('Профиль Velly')).toHaveProperty('value', config.profile);
  expect(screen.getByLabelText('Node.js')).toHaveProperty('value', config.node);
});

it('clears a startup connection error after a successful refresh', async () => {
  mockInvoke.mockRejectedValueOnce(new Error('Fixture startup failure'));
  open();
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Fixture startup failure');
  fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
  await screen.findByText('Sonnet');
  expect(screen.queryByRole('alert')).toBeNull();
});
