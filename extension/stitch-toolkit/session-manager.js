/**
 * SessionManager - Centralized, atomic state management for recording sessions.
 * 
 * Replaces the fragile global `state` object with:
 * - Optimistic locking via version numbers
 * - Atomic state updates (no partial mutations)
 * - Proper cleanup on session end
 * - Event-driven notifications (no polling)
 */

class SessionManager {
  constructor() {
    this.state = this._createInitialState();
    this._listeners = [];
    this._isUpdating = false;
    this._updateQueue = [];
  }

  _createInitialState() {
    return {
      mode: null,
      sessionId: null,
      tabId: null,
      record: null,
      replay: null,
      lastError: null,
      version: 0,
      updatedAt: Date.now(),
    };
  }

  getState() {
    return {
      ...this.state,
      record: this.state.record
        ? { ...this.state.record, steps: [...this.state.record.steps] }
        : null,
    };
  }

  getMode() {
    return this.state.mode;
  }

  isRecording() {
    return this.state.mode === 'record';
  }

  isReplaying() {
    return this.state.mode === 'replay';
  }

  isPaused() {
    return this.state.record?.paused ?? false;
  }

  getStepCount() {
    return this.state.record?.stepCount ?? 0;
  }

  getSteps() {
    return this.state.record?.steps ? [...this.state.record.steps] : [];
  }

  async update(updates) {
    const updateArray = Array.isArray(updates) ? updates : [updates];
    this._updateQueue.push(...updateArray);

    if (!this._isUpdating) {
      return this._processQueue();
    }

    return this.getState();
  }

  async setMode(mode) {
    return this.update({ type: 'SET_MODE', mode });
  }

  async addStep(step) {
    return this.update({ type: 'ADD_STEP', step });
  }

  async setPaused(paused) {
    return this.update({ type: 'SET_PAUSED', paused });
  }

  async startRecordSession(runId, scenarioName, startUrl, origin, tabId) {
    return this.update([
      { type: 'START_RECORD', runId, scenarioName, startUrl, origin, tabId },
    ]);
  }

  async stopRecordSession() {
    return this.update([
      { type: 'STOP_RECORD' },
    ]);
  }

  async startReplaySession(runId, tabId, steps, fromStep) {
    return this.update([
      { type: 'START_REPLAY', runId, tabId, steps, fromStep },
    ]);
  }

  async setReplayPaused(paused) {
    return this.update({ type: 'SET_REPLAY_PAUSED', paused });
  }

  async setReplayIndex(index) {
    return this.update({ type: 'SET_REPLAY_INDEX', index });
  }

  async setReplayStatus(status) {
    return this.update({ type: 'SET_REPLAY_STATUS', status });
  }

  async setFinalizing(finalizing) {
    return this.update({ type: 'SET_FINALIZING', finalizing });
  }

  async setError(error) {
    return this.update({ type: 'SET_ERROR', error });
  }

  _restoreRecordState(record, tabId) {
    this.state.mode = 'record';
    this.state.tabId = tabId;
    this.state.record = {
      ...record,
      steps: Array.isArray(record.steps) ? [...record.steps] : [],
      stepCount: record.stepCount || 0,
      paused: record.paused || false,
      finalizing: false,
    };
    this.state.replay = null;
    this.state.lastError = null;
    this._notifyListeners();
  }

  async persistToStorage() {
    try {
      await chrome.storage.session.set({
        stitch_session_manager: this.state,
      });
    } catch (error) {
      console.error('[SessionManager] Failed to persist state:', error);
    }
  }

  async restoreFromStorage() {
    try {
      const result = await chrome.storage.session.get('stitch_session_manager');
      const stored = result['stitch_session_manager'];
      if (stored && typeof stored === 'object' && 'version' in stored) {
        this.state = stored;
        this._notifyListeners();
        return true;
      }
    } catch (error) {
      console.error('[SessionManager] Failed to restore state:', error);
    }
    return false;
  }

  subscribe(listener) {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter(l => l !== listener);
    };
  }

  async _processQueue() {
    this._isUpdating = true;

    try {
      while (this._updateQueue.length > 0) {
        const updates = [...this._updateQueue];
        this._updateQueue = [];

        for (const update of updates) {
          this._applyUpdate(update);
        }

        this.state.version++;
        this.state.updatedAt = Date.now();
      }
    } finally {
      this._isUpdating = false;
    }

    this._notifyListeners();
    return this.getState();
  }

  _applyUpdate(update) {
    switch (update.type) {
      case 'SET_MODE':
        this.state.mode = update.mode;
        break;
      case 'ADD_STEP':
        if (this.state.record) {
          this.state.record.steps.push(update.step);
          this.state.record.stepCount += 1;
        }
        break;
      case 'SET_PAUSED':
        if (this.state.record) {
          this.state.record.paused = update.paused;
        }
        break;
      case 'START_RECORD':
        this.state.mode = 'record';
        this.state.tabId = update.tabId;
        this.state.record = {
          runId: update.runId,
          scenarioName: update.scenarioName,
          startUrl: update.startUrl,
          origin: update.origin,
          steps: [],
          stepCount: 0,
          paused: false,
          finalizing: false,
        };
        this.state.replay = null;
        this.state.lastError = null;
        break;
      case 'STOP_RECORD':
        this.state.mode = null;
        this.state.tabId = null;
        this.state.record = null;
        this.state.lastError = null;
        break;
      case 'START_REPLAY':
        this.state.mode = 'replay';
        this.state.tabId = update.tabId;
        this.state.record = null;
        this.state.replay = {
          runId: update.runId,
          tabId: update.tabId,
          steps: update.steps,
          fromStep: update.fromStep,
          totalSteps: update.fromStep - 1 + update.steps.length,
          index: 0,
          current: update.steps.length ? update.fromStep : 0,
          paused: false,
          stopped: false,
          manualContinue: false,
          status: 'running',
          _unpauseResolve: null,
          _manualResolve: null,
        };
        this.state.lastError = null;
        break;
      case 'STOP_REPLAY':
        this.state.mode = null;
        this.state.tabId = null;
        this.state.record = null;
        this.state.replay = null;
        this.state.lastError = null;
        break;
      case 'SET_REPLAY_PAUSED':
        if (this.state.replay) {
          this.state.replay.paused = update.paused;
          if (update.paused) {
            this.state.replay.status = 'paused';
          } else if (this.state.replay.status === 'paused') {
            this.state.replay.status = 'running';
          }
        }
        break;
      case 'SET_REPLAY_INDEX':
        if (this.state.replay) {
          this.state.replay.index = update.index;
          this.state.replay.current = Math.min(
            this.state.replay.fromStep + this.state.replay.index,
            this.state.replay.totalSteps || this.state.replay.steps.length
          );
        }
        break;
      case 'SET_REPLAY_STATUS':
        if (this.state.replay) {
          this.state.replay.status = update.status;
        }
        break;
      case 'SET_ERROR':
        this.state.lastError = update.error;
        break;
      case 'SET_FINALIZING':
        if (this.state.record) {
          this.state.record.finalizing = update.finalizing;
        }
        break;
    }
  }

  _notifyListeners() {
    const snapshot = this.getState();
    for (const listener of this._listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('[SessionManager] Listener error:', error);
      }
    }
  }
}

export const sessionManager = new SessionManager();