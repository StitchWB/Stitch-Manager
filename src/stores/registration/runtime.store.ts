/**
 * Runtime store - manages registration execution state
 * Handles logs, progress, results, and stage tracking
 */

import { create } from 'zustand';
import { safeInvoke } from '../../lib/tauri/core';
import type { RegistrationLog, RegistrationProgress, RegistrationStatus } from '../../types/ui';

// Stage progress data
export interface StageProgressData {
  stage: string;
  icon?: string;
  status: 'pending' | 'active' | 'success' | 'error';
  progress?: { current: number; total: number };
  startTime: number;
  message?: string;
}

// Registration result for the results table
export interface RegistrationResult {
  id: string;
  email: string;
  status: 'success' | 'failed';
  token?: string;
  error?: string;
  createdAt: string;
}

// Registration history entry
export interface RegistrationHistoryEntry {
  id: string;
  provider: string;
  email: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

const DEFAULT_PROGRESS: RegistrationProgress = {
  current: 0,
  total: 0,
  percentage: 0,
};

interface RuntimeState {
  // Status
  isRunning: boolean;
  status: RegistrationStatus;

  // Progress
  progress: RegistrationProgress;

  // Logs
  logs: RegistrationLog[];
  activeProvider: string;

  // Results
  results: RegistrationResult[];
  successCount: number;
  failedCount: number;

  // History
  history: RegistrationHistoryEntry[];

  // WebSocket
  wsConnected: boolean;

  // Stage progress tracking
  currentStage: string | null;
  stageProgress: Map<string, StageProgressData>;
  stageTimers: Map<string, number>; // start timestamps

  // Actions - Logs
  addLog: (log: Omit<RegistrationLog, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  setActiveProvider: (provider: string) => void;

  // Actions - Progress
  setProgress: (progress: Partial<RegistrationProgress>) => void;

  // Actions - Stage progress
  setCurrentStage: (stage: string | null) => void;
  updateStageProgress: (stage: string, current: number, total: number, message?: string) => void;
  completeStage: (stage: string, status: 'success' | 'error') => void;
  clearStageProgress: () => void;

  // Actions - Results
  addResult: (result: Omit<RegistrationResult, 'id' | 'createdAt'>) => void;
  clearResults: () => void;

  // Actions - History
  addHistoryEntry: (entry: Omit<RegistrationHistoryEntry, 'id' | 'createdAt'>) => void;

  // Actions - WebSocket
  setWsConnected: (connected: boolean) => void;

  // Actions - Status
  setIsRunning: (running: boolean) => void;
  setStatus: (status: RegistrationStatus) => void;

  // Job tracking (survives page navigation)
  pipelineJobId: string | null;
  activeThreads: number;
  isStopping: boolean;
  setPipelineJobId: (jobId: string | null) => void;
  setActiveThreads: (threads: number) => void;
  setIsStopping: (stopping: boolean) => void;
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  // Initial state
  isRunning: false,
  status: 'pending',
  progress: DEFAULT_PROGRESS,
  logs: [],
  activeProvider: 'all',
  results: [],
  successCount: 0,
  failedCount: 0,
  history: [],
  wsConnected: false,

  // Job tracking (survives page navigation)
  pipelineJobId: null,
  activeThreads: 0,
  isStopping: false,

  // Stage progress tracking
  currentStage: null,
  stageProgress: new Map(),
  stageTimers: new Map(),

  // Log actions
  addLog: (log: Omit<RegistrationLog, 'id' | 'timestamp'>) => {
    const state = get();
    const now = Date.now();

    // Deduplicate identical messages within a short window. The previous
    // implementation only checked the immediately-preceding log, which missed
    // INTERLEAVED duplicates (e.g. the same line arriving from 2-3 sources
    // out of order). Scan the tail of the buffer within a 2s window instead.
    const DEDUP_WINDOW_MS = 2000;
    const DEDUP_SCAN = 12; // only inspect the most recent entries
    const tail = state.logs.slice(-DEDUP_SCAN);
    for (let i = tail.length - 1; i >= 0; i--) {
      const prev = tail[i];
      if (prev.message !== log.message || prev.level !== log.level) continue;
      const dt = now - new Date(prev.timestamp).getTime();
      if (dt <= DEDUP_WINDOW_MS) {
        return; // duplicate within window — drop
      }
    }

    const newLog = {
      ...log,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    // Add to local registration logs (cap to prevent unbounded WebView memory growth)
    const MAX_LOGS = 2000;
    set(state => {
      const next = [...state.logs, newLog];
      return {
        logs: next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next,
      };
    });

    // Persist only high-signal registration logs to DB.
    // Full per-line stream (especially Python stderr) can flood SQLite and
    // starve the small shared pool during batch registration.
    if (log.level === 'error' || log.level === 'warn' || log.level === 'success') {
      safeInvoke('add_log', {
        level: log.level,
        source: 'registration',
        message: log.message,
        details: null,
      }).catch((err: unknown) => {
        console.error('Failed to save log to database:', err);
      });
    }
  },

  clearLogs: () => set({ logs: [] }),

  setActiveProvider: (provider: string) => set({ activeProvider: provider }),

  // Progress actions
  setProgress: (progress: Partial<RegistrationProgress>) =>
    set(state => ({
      progress: { ...state.progress, ...progress },
    })),

  // Result actions
  addResult: (result: Omit<RegistrationResult, 'id' | 'createdAt'>) =>
    set(state => {
      const newResult: RegistrationResult = {
        ...result,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      return {
        results: [...state.results, newResult],
        successCount: result.status === 'success' ? state.successCount + 1 : state.successCount,
        failedCount: result.status === 'failed' ? state.failedCount + 1 : state.failedCount,
      };
    }),

  clearResults: () =>
    set({
      results: [],
      successCount: 0,
      failedCount: 0,
    }),

  // History actions
  addHistoryEntry: (entry: Omit<RegistrationHistoryEntry, 'id' | 'createdAt'>) =>
    set(state => ({
      history: [
        {
          ...entry,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        },
        ...state.history,
      ].slice(0, 50), // Keep only last 50 entries
    })),

  // Stage progress actions
  setCurrentStage: (stage: string | null) => {
    const { stageProgress, stageTimers } = get();
    const now = Date.now();

    // Update previous stage to success if exists
    if (get().currentStage) {
      const prevStage = get().currentStage!;
      const prevData = stageProgress.get(prevStage);
      if (prevData) {
        stageProgress.set(prevStage, { ...prevData, status: 'success' });
      }
    }

    // Start new stage
    if (stage) {
      stageProgress.set(stage, {
        stage,
        status: 'active',
        startTime: now,
      });
      stageTimers.set(stage, now);
    }

    set({
      currentStage: stage,
      stageProgress: new Map(stageProgress),
      stageTimers: new Map(stageTimers),
    });
  },

  updateStageProgress: (stage: string, current: number, total: number, message?: string) => {
    const { stageProgress } = get();
    const data = stageProgress.get(stage);

    if (data) {
      stageProgress.set(stage, {
        ...data,
        progress: { current, total },
        message,
      });
      set({ stageProgress: new Map(stageProgress) });
    }
  },

  completeStage: (stage: string, status: 'success' | 'error') => {
    const { stageProgress, stageTimers } = get();
    const data = stageProgress.get(stage);

    if (data) {
      stageProgress.set(stage, { ...data, status });
      stageTimers.delete(stage);
      set({
        stageProgress: new Map(stageProgress),
        stageTimers: new Map(stageTimers),
        currentStage: null,
      });
    }
  },

  clearStageProgress: () => {
    set({
      currentStage: null,
      stageProgress: new Map(),
      stageTimers: new Map(),
    });
  },

  // WebSocket actions
  setWsConnected: (connected: boolean) => set({ wsConnected: connected }),

  // Status actions
  setIsRunning: (running: boolean) => set({ isRunning: running }),
  setStatus: (status: RegistrationStatus) => set({ status }),

  // Job tracking actions (survive page navigation)
  setPipelineJobId: (pipelineJobId: string | null) => set({ pipelineJobId }),
  setActiveThreads: (activeThreads: number) => set({ activeThreads }),
  setIsStopping: (isStopping: boolean) => set({ isStopping }),
}));
