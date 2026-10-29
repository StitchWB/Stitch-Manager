import { buildTaskTypeFromState } from '@/pages/Scheduler/components/taskForm/taskConfig';

describe('buildTaskTypeFromState wire contract', () => {
  it('emits flat customScript for scenario', () => {
    expect(buildTaskTypeFromState('scenario', '', '')).toEqual({
      type: 'customScript',
      scriptPath: 'python/run_scenario_replay.py',
    });
  });

  it('emits flat customScript for composedFlow', () => {
    expect(buildTaskTypeFromState('composedFlow', '', '')).toEqual({
      type: 'customScript',
      scriptPath: 'python/run_composed_flow.py',
    });
  });

  it('emits flat customScript with the caller script path', () => {
    expect(buildTaskTypeFromState('script', 'python/my.py', '')).toEqual({
      type: 'customScript',
      scriptPath: 'python/my.py',
    });
  });

  it('falls back to the default script path when empty', () => {
    expect(buildTaskTypeFromState('script', '   ', '')).toEqual({
      type: 'customScript',
      scriptPath: 'python/run_scenario_replay.py',
    });
  });

  it('emits flat checkinProvider — not the registerProvider alias', () => {
    expect(buildTaskTypeFromState('checkinProvider', '', ' jev ')).toEqual({
      type: 'checkinProvider',
      provider: 'jev',
    });
  });

  it('emits flat refreshTokenPool — not the refreshToken alias', () => {
    expect(buildTaskTypeFromState('refreshTokenPool', '', ' outlook ')).toEqual({
      type: 'refreshTokenPool',
      provider: 'outlook',
    });
  });
});
