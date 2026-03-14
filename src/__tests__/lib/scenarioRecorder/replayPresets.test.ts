import { describe, it, expect, beforeEach } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useReplayPresets } from '../../../lib/scenarioRecorder/replayPresets';

describe('useReplayPresets', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('saves and reads presets for profile alias', () => {
    const { result } = renderHook(() => useReplayPresets({ alias: 'profile-a' }));

    act(() => {
      result.current.savePreset('Main run', {
        scenarioPath: 'scenario://one',
        startUrl: 'https://example.com',
        configJson: '{}',
        continueOnError: false,
      });
    });

    expect(result.current.presets).toHaveLength(1);
    expect(result.current.presets[0]?.name).toBe('Main run');
    expect(result.current.presets[0]?.scenarioPath).toBe('scenario://one');
  });

  it('isolates presets between aliases', () => {
    const a = renderHook(() => useReplayPresets({ alias: 'profile-a' }));
    const b = renderHook(() => useReplayPresets({ alias: 'profile-b' }));

    act(() => {
      a.result.current.savePreset('Preset A', {
        scenarioPath: 'scenario://a',
        startUrl: 'https://a.dev',
        configJson: '{}',
        continueOnError: true,
      });
    });

    expect(a.result.current.presets).toHaveLength(1);
    expect(b.result.current.presets).toHaveLength(0);
  });

  it('deletes preset by id', () => {
    const { result } = renderHook(() => useReplayPresets({ alias: 'profile-a' }));

    act(() => {
      result.current.savePreset('Delete me', {
        scenarioPath: 'scenario://delete',
        startUrl: 'https://example.com',
        configJson: '{}',
        continueOnError: false,
      });
    });

    const id = result.current.presets[0]?.id;
    expect(id).toBeTruthy();

    act(() => {
      if (id) result.current.deletePreset(id);
    });

    expect(result.current.presets).toHaveLength(0);
  });

  it('renames preset and updates fields', () => {
    const { result } = renderHook(() => useReplayPresets({ alias: 'profile-a' }));

    act(() => {
      result.current.savePreset('Old name', {
        scenarioPath: 'scenario://rename',
        startUrl: 'https://example.com',
        configJson: '{}',
        continueOnError: false,
      });
    });

    const id = result.current.presets[0]?.id;
    expect(id).toBeTruthy();

    act(() => {
      if (id) result.current.renamePreset(id, 'New name');
    });

    expect(result.current.presets[0]?.name).toBe('New name');
  });

  it('marks preset as used', () => {
    const { result } = renderHook(() => useReplayPresets({ alias: 'profile-a' }));

    act(() => {
      result.current.savePreset('Use me', {
        scenarioPath: 'scenario://use',
        startUrl: 'https://example.com',
        configJson: '{}',
        continueOnError: false,
      });
    });

    const id = result.current.presets[0]?.id;
    expect(id).toBeTruthy();

    act(() => {
      if (id) result.current.markPresetUsed(id);
    });

    expect(result.current.presets[0]?.lastUsedAt).toBeTruthy();
  });
});
