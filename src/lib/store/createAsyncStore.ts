import { create } from 'zustand';
import type { StateCreator, StoreApi, UseBoundStore } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { PersistOptions } from 'zustand/middleware';
import { detailToMessage } from '../errorText';

type DataPart<State> = {
  [K in keyof State as State[K] extends (...args: never[]) => unknown ? never : K]: State[K];
};

type ActionsPart<State> = {
  [K in keyof State as State[K] extends (...args: never[]) => unknown ? K : never]: State[K];
};

type SetState<State> = StoreApi<State>['setState'];

interface BaseConfig<State extends object> {
  name: string;
  devtools?: boolean;
  persist?: boolean | PersistOptions<State, unknown>;
}

interface FetchConfig<
  State extends object,
  FetchName extends keyof ActionsPart<State> & string,
> extends BaseConfig<State> {
  fetch: State extends { loading: boolean; error: string | null }
    ? (...args: never[]) => Promise<Partial<State> | void>
    : never;
  fetchName: FetchName;
  initial: Omit<DataPart<State>, 'loading' | 'error'>;
  actions?: (set: SetState<State>, get: () => State) => Omit<ActionsPart<State>, FetchName>;
}

interface PlainConfig<State extends object> extends BaseConfig<State> {
  initial: DataPart<State>;
  actions?: (set: SetState<State>, get: () => State) => ActionsPart<State>;
}

export function createAsyncStore<
  State extends object,
  FetchName extends keyof ActionsPart<State> & string = never,
>(config: FetchConfig<State, FetchName>): UseBoundStore<StoreApi<State>>;
export function createAsyncStore<State extends object>(
  config: PlainConfig<State>,
): UseBoundStore<StoreApi<State>>;
export function createAsyncStore<State extends object>(config: BaseConfig<State> & {
  fetch?: (...args: never[]) => Promise<Partial<State> | void>;
  fetchName?: string;
  initial: unknown;
  actions?: (set: SetState<State>, get: () => State) => object;
}): UseBoundStore<StoreApi<State>> {
  const creator: StateCreator<State> = (set, get) => {
    const state: Record<string, unknown> = { ...(config.initial as Record<string, unknown>) };
    if (config.fetch && config.fetchName) {
      const run = config.fetch as (...args: unknown[]) => Promise<Partial<State> | void>;
      state.loading = false;
      state.error = null;
      state[config.fetchName] = async (...args: unknown[]): Promise<void> => {
        set({ loading: true, error: null } as unknown as Partial<State>);
        try {
          const result = await run(...args);
          if (result) set(result);
        } catch (err) {
          const message = err instanceof Error ? detailToMessage(err.message, String(err)) : String(err);
          set({ error: message } as unknown as Partial<State>);
        } finally {
          set({ loading: false } as unknown as Partial<State>);
        }
      };
    }
    return { ...state, ...config.actions?.(set, get) } as unknown as State;
  };

  const persistOptions = config.persist
    ? config.persist === true
      ? { name: config.name }
      : config.persist
    : undefined;
  const withPersist = persistOptions
    ? persist(creator as StateCreator<State, [['zustand/persist', unknown]]>, persistOptions)
    : creator;
  const withDevtools = config.devtools
    ? devtools(withPersist as StateCreator<State, [['zustand/devtools', never]]>, { name: config.name })
    : withPersist;
  return create<State>()(withDevtools as StateCreator<State>);
}
