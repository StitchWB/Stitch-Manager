import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import {
  devboxActionSucceeded,
  devboxAgentPrompt,
  devboxCockpitOpen,
  devboxConnectionCheck,
  devboxEnvGet,
  devboxEnvSet,
  devboxHandoffBlock,
  devboxIngressControl,
  devboxIssueTokens,
  devboxProfileGet,
  devboxProfilePut,
  devboxStackDown,
  devboxStackStart,
  devboxWatchdogControl,
  type DevboxAccepted,
  type DevboxActionStatus,
  type DevboxConnection,
  type DevboxConnectionCheckResult,
  type DevboxEnvEntry,
  type DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import { cardVitalState, findVitalCard, stackVitalState } from './state';
import { serializeProfileWrite } from './profileWriteLock';

export type DevboxTab = 'overview' | 'connect' | 'agent' | 'services' | 'projects' | 'logs';
export type DevboxIngressMode = 'auto' | 'cloudflare' | 'relay' | 'manual';
export type DevboxAccessMode = 'readonly' | 'standard' | 'full';
export type DevboxAccessPreset = DevboxAccessMode | 'custom';
export type DevboxAgentLocation = 'sandbox' | 'chat';

export interface DevboxTokenRow {
  id: string;
  envKey: string;
  labelKey: string;
  descKey: string;
  value: string;
  masked: boolean;
  available: boolean;
}

export interface DevboxDetection {
  messageKey: string;
  recommendedMode: DevboxIngressMode | null;
}

interface TokenDefinition {
  id: string;
  envKey: string;
  labelKey: string;
  descKey: string;
}

interface ProbeState {
  result: DevboxConnectionCheckResult;
  checkedAt: number;
  signature: string;
}

interface HandoffState {
  block: string;
  masked: boolean;
  signature: string;
}

interface ConnectionState {
  connection: DevboxConnection | null;
  bootstrap: string;
  signature: string;
  revealed: boolean;
}

export const DEVBOX_TOTAL_TOOLS = 16;

const TOKEN_DEFS: ReadonlyArray<TokenDefinition> = [
  {
    id: 'BRIDGE_TOKEN',
    envKey: 'MCP_BEARER_TOKEN',
    labelKey: 'devboxPage.connectTokenBridge',
    descKey: 'devboxPage.connectTokenBridgeDesc',
  },
  {
    id: 'HOST_TOKEN',
    envKey: 'MCP_PUBLIC_TOKEN',
    labelKey: 'devboxPage.connectTokenHost',
    descKey: 'devboxPage.connectTokenHostDesc',
  },
  {
    id: 'INGRESS_TOKEN',
    envKey: 'INGRESS_TOKEN',
    labelKey: 'devboxPage.connectTokenIngress',
    descKey: 'devboxPage.connectTokenIngressDesc',
  },
  {
    id: 'GATEWAY_TOKEN',
    envKey: 'GATEWAY_TOKEN',
    labelKey: 'devboxPage.connectTokenGateway',
    descKey: 'devboxPage.connectTokenGatewayDesc',
  },
];

const MUTATION_CMDS = new Set([
  'issue_tokens',
  'ingress_control',
  'stack_start',
  'stack_down',
  'stack_full_down',
  'profile_use',
  'allow_port',
]);
const BOOTSTRAP_HEADING = '## 1. Bootstrap — выполни до всего остального';
const BOOTSTRAP_FENCE = '```bash';

export const ACCESS_PERMISSIONS: Record<DevboxAccessMode, { edit: string; write: string; bash: string }> = {
  readonly: { edit: 'deny', write: 'deny', bash: 'deny' },
  standard: { edit: 'ask', write: 'ask', bash: 'ask' },
  full: { edit: 'allow', write: 'allow', bash: 'allow' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function normalizeIngressMode(value: string | undefined): DevboxIngressMode {
  const mode = (value ?? '').trim().toLowerCase();
  if (mode === 'cloudflare' || mode === 'relay' || mode === 'manual') return mode;
  return 'auto';
}

function normalizeAccessMode(value: string): DevboxAccessPreset {
  if (value === 'readonly' || value === 'standard' || value === 'full') return value;
  return 'custom';
}

function envValue(entries: DevboxEnvEntry[], key: string): string {
  const entry = entries.find(row => row.key === key);
  return entry ? entry.value : '';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function extractBootstrap(prompt: string): string {
  const start = prompt.indexOf(BOOTSTRAP_HEADING);
  if (start < 0) return '';
  const after = prompt.slice(start + BOOTSTRAP_HEADING.length);
  const open = after.indexOf(BOOTSTRAP_FENCE);
  if (open < 0) return '';
  const bodyStart = open + BOOTSTRAP_FENCE.length;
  const close = after.indexOf('```', bodyStart);
  if (close < 0) return '';
  return after.slice(bodyStart, close).trim();
}

function parseHandoffTokens(block: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!TOKEN_DEFS.some(def => def.id === key)) continue;
    const rest = line.slice(eq + 1).trim();
    const value = rest.split(/\s+/)[0] ?? '';
    tokens[key] = value;
  }
  return tokens;
}

export function buildChatConfig(connection: DevboxConnection | null): string {
  if (connection === null || connection.endpoints.length === 0) return '';
  const servers: Record<string, unknown> = {};
  for (const endpoint of connection.endpoints) {
    const name = endpoint.id === 'bridge' ? 'devbox' : `devbox-${endpoint.id}`;
    servers[name] = {
      type: 'http',
      url: endpoint.url,
      headers: { Authorization: `Bearer ${endpoint.token}` },
    };
  }
  return JSON.stringify({ mcpServers: servers }, null, 2);
}

export interface UseDevboxConnectParams {
  activeProfile: string;
  cards: DevboxVitalCard[] | null;
  actionStatus: DevboxActionStatus | null;
  envVersion?: number;
  busy: boolean;
  onAction: (action: Promise<DevboxAccepted>) => void;
  onChanged: () => void;
}

export function useDevboxConnect({
  activeProfile,
  cards,
  actionStatus,
  envVersion,
  busy,
  onAction,
  onChanged,
}: UseDevboxConnectParams) {
  const [entries, setEntries] = useState<DevboxEnvEntry[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [envLoading, setEnvLoading] = useState(true);
  const [envError, setEnvError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [restartKinds, setRestartKinds] = useState<string[]>([]);
  const [mutationEpoch, setMutationEpoch] = useState(0);

  const [profileJson, setProfileJson] = useState<string | null>(null);
  const [profileModel, setProfileModel] = useState<Record<string, unknown> | null>(null);
  const [profileMode, setProfileMode] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [accessSaving, setAccessSaving] = useState(false);
  const [profileTick, setProfileTick] = useState(0);

  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [checking, setChecking] = useState(false);
  const [handoff, setHandoff] = useState<HandoffState | null>(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffRevealed, setHandoffRevealed] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const handoffRevealedRef = useRef(false);
  const connectionRevealedRef = useRef(false);
  const handoffRef = useRef<HandoffState | null>(null);
  const connectionRef = useRef<ConnectionState | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const checkingRef = useRef(false);
  const checkedSignatureRef = useRef<string | null>(null);
  const handoffSeqRef = useRef(0);
  const connectionSeqRef = useRef(0);
  const profileSeqRef = useRef(0);
  const lastMutationIdRef = useRef<string | null | undefined>(undefined);
  handoffRef.current = handoff;
  connectionRef.current = connectionState;

  const savedIngressModeRaw = envValue(entries, 'INGRESS_MODE');
  const savedSubdomain = envValue(entries, 'RELAY_SUBDOMAIN');
  const savedPublicUrl = envValue(entries, 'PUBLIC_URL');
  const savedRelayUrl = envValue(entries, 'RELAY_URL');
  const savedMode = normalizeIngressMode(savedIngressModeRaw);
  const draftMode = normalizeIngressMode(draft.INGRESS_MODE);

  const savedTunnelToken = envValue(entries, 'TUNNEL_TOKEN');
  const savedSignature = useMemo(
    () =>
      [
        savedIngressModeRaw,
        savedSubdomain,
        savedPublicUrl,
        savedRelayUrl,
        savedTunnelToken,
        activeProfile,
        profileMode,
        String(mutationEpoch),
      ].join('|'),
    [savedIngressModeRaw, savedSubdomain, savedPublicUrl, savedRelayUrl, savedTunnelToken, activeProfile, profileMode, mutationEpoch],
  );

  const savedSignatureRef = useRef(savedSignature);
  savedSignatureRef.current = savedSignature;

  const envSeqRef = useRef(0);
  const loadEnv = useCallback(async () => {
    const seq = ++envSeqRef.current;
    setEnvLoading(true);
    setEnvError(null);
    try {
      const result = await devboxEnvGet();
      if (seq !== envSeqRef.current) return;
      const list = Array.isArray(result?.entries) ? result.entries : [];
      const initial: Record<string, string> = {};
      for (const entry of list) initial[entry.key] = entry.secret ? '' : entry.value;
      const previous = entriesRef.current;
      setEntries(list);
      // watchdog переписывает .env мимо этого стейта — перечитывание не должно
      // затирать несохранённые правки, поэтому сохраняем только реально
      // изменённые пользователем значения
      setDraft(prev => {
        const next = { ...initial };
        for (const key of Object.keys(prev)) {
          const oldEntry = previous.find(entry => entry.key === key);
          if (oldEntry !== undefined && !oldEntry.readonly && prev[key] !== oldEntry.value) {
            next[key] = prev[key];
          }
        }
        return next;
      });
      setSaved(false);
      setErrors([]);
    } catch (err) {
      if (seq !== envSeqRef.current) return;
      setEnvError(err instanceof Error ? err.message : String(err));
      setEntries([]);
      setDraft({});
    } finally {
      if (seq === envSeqRef.current) setEnvLoading(false);
    }
  }, []);

  const loadProfile = useCallback(async () => {
    const name = activeProfile;
    if (name === '') {
      setProfileJson(null);
      setProfileModel(null);
      setProfileMode('');
      setProfileError(null);
      setProfileLoading(false);
      return;
    }
    const seq = ++profileSeqRef.current;
    setProfileLoading(true);
    setProfileError(null);
    try {
      const result = await devboxProfileGet(name);
      if (seq !== profileSeqRef.current) return;
      const model = parseJsonObject(result.json);
      setProfileJson(result.json);
      setProfileModel(model);
      setProfileMode(model !== null && typeof model.mode === 'string' ? model.mode : '');
    } catch (err) {
      if (seq !== profileSeqRef.current) return;
      setProfileJson(null);
      setProfileModel(null);
      setProfileMode('');
      setProfileError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === profileSeqRef.current) setProfileLoading(false);
    }
  }, [activeProfile]);

  useEffect(() => {
    void loadEnv();
  }, [loadEnv]);

  // watchdog переписывает .env мимо action-событий — ловим это через mtime
  // версии из poll и перечитываем конфиг, иначе UI показывает мёртвый URL
  const envVersionRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (envVersion === undefined) return;
    if (envVersionRef.current === undefined) {
      envVersionRef.current = envVersion;
      return;
    }
    if (envVersionRef.current === envVersion) return;
    envVersionRef.current = envVersion;
    void loadEnv();
  }, [envVersion, loadEnv]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile, profileTick]);

  const runCheck = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    const signature = savedSignatureRef.current;
    checkedSignatureRef.current = signature;
    try {
      const result = await devboxConnectionCheck();
      setProbe({ result, checkedAt: Date.now(), signature });
    } catch (err) {
      setProbe({
        result: { ok: false, error: err instanceof Error ? err.message : String(err) },
        checkedAt: Date.now(),
        signature,
      });
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, []);

  const loadHandoff = useCallback(async (reveal: boolean, signature: string) => {
    const seq = ++handoffSeqRef.current;
    setHandoffLoading(true);
    setHandoffError(null);
    try {
      const result = await devboxHandoffBlock(reveal);
      if (seq !== handoffSeqRef.current) return;
      setHandoff({
        block: typeof result?.block === 'string' ? result.block : '',
        masked: result?.masked === true,
        signature,
      });
      setHandoffRevealed(reveal);
      handoffRevealedRef.current = reveal;
    } catch (err) {
      if (seq !== handoffSeqRef.current) return;
      setHandoff(null);
      setHandoffError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === handoffSeqRef.current) setHandoffLoading(false);
    }
  }, []);

  const loadConnection = useCallback(async (reveal: boolean, signature: string) => {
    const seq = ++connectionSeqRef.current;
    setConnectionLoading(true);
    setConnectionError(null);
    try {
      const result = await devboxAgentPrompt({ task: '', acceptance: '', reveal, client: 'universal' });
      if (seq !== connectionSeqRef.current) return;
      setConnectionState({
        connection: result.connection ?? null,
        bootstrap: extractBootstrap(result.prompt),
        signature,
        revealed: reveal,
      });
      connectionRevealedRef.current = reveal;
    } catch (err) {
      if (seq !== connectionSeqRef.current) return;
      setConnectionState(null);
      setConnectionError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === connectionSeqRef.current) setConnectionLoading(false);
    }
  }, []);

  // проверка может измениться, пока предыдущий запрос ещё в полёте —
  // тогда повторный runCheck рано выходит по checkingRef, и проба навсегда
  // остаётся «устаревшей»; поэтому сверяем именно последнюю проверенную
  // сигнатуру и перезапускаем, когда in-flight проверка завершилась
  useEffect(() => {
    if (envLoading || checking) return;
    if (checkedSignatureRef.current === savedSignature) return;
    void runCheck();
  }, [envLoading, checking, savedSignature, runCheck]);

  useEffect(() => {
    if (envLoading) return;
    void loadHandoff(handoffRevealedRef.current, savedSignature);
    void loadConnection(connectionRevealedRef.current, savedSignature);
  }, [envLoading, savedSignature, loadHandoff, loadConnection]);

  useEffect(() => {
    const rows = actionStatus?.recent ?? [];
    const done = [...rows].reverse().find(row => MUTATION_CMDS.has(row.cmd) && devboxActionSucceeded(row));
    // первый прогон всегда базовый — иначе первая же реальная мутация
    // проглатывается: без неё не было бы epoch-бампа, loadEnv и сброса reveal
    if (lastMutationIdRef.current === undefined) {
      lastMutationIdRef.current = done?.id ?? null;
      return;
    }
    if (done === undefined || lastMutationIdRef.current === done.id) return;
    lastMutationIdRef.current = done.id;
    handoffRevealedRef.current = false;
    connectionRevealedRef.current = false;
    setHandoffRevealed(false);
    setRestartKinds([]);
    // токены уже отозваны бэкендом — стираем немедленно, не ждём masked-рефетч
    setHandoff(null);
    setConnectionState(null);
    setMutationEpoch(epoch => epoch + 1);
    void loadEnv();
    setProfileTick(tick => tick + 1);
    // cockpit/CLI-мутации не проходят onAction — без этого profiles/activeProfile
    // остаются старыми и startStack переключает профиль обратно
    onChanged();
  }, [actionStatus, loadEnv, onChanged]);

  const patch = useMemo(() => {
    const diff: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.readonly) continue;
      const current = draft[entry.key] ?? '';
      // у секретов пустой драфт = «оставить как есть»; без этого правки
      // замаскированного '...' улетали бы на сервер и портили токен
      if (entry.secret && current === '') continue;
      if (current !== entry.value) diff[entry.key] = current;
    }
    return diff;
  }, [entries, draft]);

  const hasChanges = Object.keys(patch).length > 0;

  const setField = useCallback((key: string, value: string) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    setSaved(false);
    setErrors([]);
  }, []);

  const saveEnv = useCallback(async (): Promise<boolean> => {
    if (!hasChanges || saving || busy) return false;
    if (draftMode === 'relay' && (draft.RELAY_SUBDOMAIN ?? '').trim() === '') {
      setErrors([t('devboxPage.connectRelaySubdomainRequired')]);
      setSaved(false);
      return false;
    }
    setSaving(true);
    setErrors([]);
    try {
      const result = await devboxEnvSet(patch);
      if (!result.valid) {
        setErrors(result.errors.length > 0 ? result.errors : [t('devboxPage.connectSaveFailed')]);
        setSaved(false);
        return false;
      }
      setRestartKinds(Array.isArray(result.restart) ? result.restart : []);
      setSaved(true);
      setEntries(prev =>
        prev.map(entry => (entry.key in patch ? { ...entry, value: patch[entry.key] } : entry)),
      );
      // сохранённые секреты возвращаются в «пусто» — иначе драфт с реальным
      // значением продолжил бы показывать поле как изменённое
      setDraft(prev => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry.secret && entry.key in patch) next[entry.key] = '';
        }
        return next;
      });
      onChanged();
      return true;
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
      setSaved(false);
      return false;
    } finally {
      setSaving(false);
    }
  }, [hasChanges, saving, busy, draftMode, draft, patch, entries, onChanged]);

  const saveAccess = useCallback(
    async (mode: DevboxAccessMode): Promise<boolean> => {
      if (activeProfile === '' || accessSaving || busy) return false;
      setAccessSaving(true);
      setProfileError(null);
      try {
        // re-GET inside the write lock — the cached profileJson may be stale
        // after edits made on the Projects/Services tabs
        const { model, json } = await serializeProfileWrite(async () => {
          const fresh = await devboxProfileGet(activeProfile);
          const next = parseJsonObject(fresh.json);
          if (next === null) throw new Error(t('devboxPage.connectAccessSaveFailed'));
          next.mode = mode;
          const nextJson = JSON.stringify(next, null, 2);
          const result = await devboxProfilePut(activeProfile, nextJson);
          if (!result.valid) {
            throw new Error(
              result.errors.length > 0
                ? result.errors.join('; ')
                : t('devboxPage.connectAccessSaveFailed'),
            );
          }
          return { model: next, json: nextJson };
        });
        setProfileJson(json);
        setProfileModel(model);
        setProfileMode(mode);
        onChanged();
        return true;
      } catch (err) {
        setProfileError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setAccessSaving(false);
      }
    },
    [activeProfile, accessSaving, busy, onChanged],
  );

  const ensureHandoffRevealed = useCallback(async (): Promise<string> => {
    const current = handoffRef.current;
    if (
      handoffRevealedRef.current &&
      current !== null &&
      current.block !== '' &&
      current.signature === savedSignatureRef.current
    ) {
      return current.block;
    }
    const seq = ++handoffSeqRef.current;
    setHandoffLoading(true);
    setHandoffError(null);
    const signature = savedSignatureRef.current;
    try {
      const result = await devboxHandoffBlock(true);
      if (seq !== handoffSeqRef.current) return '';
      const block = typeof result?.block === 'string' ? result.block : '';
      setHandoff({ block, masked: result?.masked === true, signature });
      setHandoffRevealed(true);
      handoffRevealedRef.current = true;
      return block;
    } catch (err) {
      if (seq !== handoffSeqRef.current) return '';
      setHandoffError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      if (seq === handoffSeqRef.current) setHandoffLoading(false);
    }
  }, []);

  const hideHandoff = useCallback(() => {
    void loadHandoff(false, savedSignatureRef.current);
  }, [loadHandoff]);

  const ensureConnectionRevealed = useCallback(async (): Promise<{
    connection: DevboxConnection | null;
    bootstrap: string;
  }> => {
    const current = connectionRef.current;
    if (
      connectionRevealedRef.current &&
      current !== null &&
      current.connection !== null &&
      current.signature === savedSignatureRef.current
    ) {
      return { connection: current.connection, bootstrap: current.bootstrap };
    }
    const seq = ++connectionSeqRef.current;
    setConnectionLoading(true);
    setConnectionError(null);
    const signature = savedSignatureRef.current;
    try {
      const result = await devboxAgentPrompt({ task: '', acceptance: '', reveal: true, client: 'universal' });
      if (seq !== connectionSeqRef.current) return { connection: null, bootstrap: '' };
      const connection = result.connection ?? null;
      const bootstrap = extractBootstrap(result.prompt);
      setConnectionState({
        connection,
        bootstrap,
        signature,
        revealed: true,
      });
      connectionRevealedRef.current = true;
      return { connection, bootstrap };
    } catch (err) {
      if (seq !== connectionSeqRef.current) return { connection: null, bootstrap: '' };
      setConnectionError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      if (seq === connectionSeqRef.current) setConnectionLoading(false);
    }
  }, []);

  const ensureTokensRevealed = useCallback(async (): Promise<Record<string, string>> => {
    const block = await ensureHandoffRevealed();
    return parseHandoffTokens(block);
  }, [ensureHandoffRevealed]);

  const startStack = useCallback(() => {
    if (activeProfile !== '') onAction(devboxStackStart(activeProfile, false));
  }, [activeProfile, onAction]);
  const stopStack = useCallback(() => {
    onAction(devboxStackDown());
  }, [onAction]);
  const restartIngress = useCallback(() => {
    void askConfirm({
      title: t('devboxPage.controlIngressOn'),
      message: t('devboxPage.tipIngress'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
      variant: 'warning',
    }).then(confirmed => {
      if (confirmed) onAction(devboxIngressControl('up'));
    });
  }, [onAction]);
  const rotateTokens = useCallback(() => {
    onAction(devboxIssueTokens());
  }, [onAction]);
  const openCockpit = useCallback(async (): Promise<string | null> => {
    try {
      const result = await devboxCockpitOpen();
      return typeof result?.url === 'string' && result.url !== '' ? result.url : null;
    } catch {
      return null;
    }
  }, []);
  const toggleWatchdog = useCallback(
    (next: boolean) => {
      onAction(devboxWatchdogControl(next ? 'start' : 'stop'));
    },
    [onAction],
  );

  const reload = useCallback(() => {
    void loadEnv();
    setProfileTick(tick => tick + 1);
    void runCheck();
    void loadHandoff(handoffRevealedRef.current, savedSignatureRef.current);
    void loadConnection(connectionRevealedRef.current, savedSignatureRef.current);
  }, [loadEnv, runCheck, loadHandoff, loadConnection]);

  const connection = connectionState?.connection ?? null;
  const bootstrap = connectionState?.bootstrap ?? '';
  const connectionStale = connectionState !== null && connectionState.signature !== savedSignature;
  const handoffBlock = handoff?.block ?? '';
  const handoffStale = handoff !== null && handoff.signature !== savedSignature;
  const chatConfig = useMemo(() => buildChatConfig(connection), [connection]);

  const bridgeEndpoint = useMemo(
    () => connection?.endpoints.find(endpoint => endpoint.id === 'bridge') ?? null,
    [connection],
  );
  const probeResult = probe?.result ?? null;
  const probeStale = probe !== null && probe.signature !== savedSignature;
  const probeFresh = probe !== null && !probeStale;
  const probeUrl = probeFresh && typeof probeResult?.url === 'string' ? probeResult.url : '';
  const probeMode =
    probeFresh && probeResult !== null && typeof probeResult.mode === 'string'
      ? normalizeIngressMode(probeResult.mode)
      : null;
  const effectiveMode = probeMode ?? savedMode;
  const fallbackActive = savedMode === 'auto' && probeMode === 'manual' && savedPublicUrl !== '';
  const probeOk = probeResult?.ok === true && probeFresh;
  const tools = probeOk ? Number(probeResult?.tools ?? 0) : 0;
  const latency = probeOk ? Number(probeResult?.latency_ms ?? 0) : null;

  const fallbackBase = savedRelayUrl !== '' ? savedRelayUrl : savedPublicUrl;
  const resolvedUrl =
    bridgeEndpoint !== null && bridgeEndpoint.url !== ''
      ? bridgeEndpoint.url
      : probeUrl !== ''
        ? probeUrl
        : fallbackBase !== ''
          ? `${trimTrailingSlash(fallbackBase)}/p/8787/mcp`
          : '';

  const stackState = stackVitalState(cards);
  const bridgeState = cardVitalState(findVitalCard(cards, 'bridge'), 'bridge');
  const ingressState = cardVitalState(findVitalCard(cards, 'ingress'), 'ingress');
  const watchdogState = cardVitalState(findVitalCard(cards, 'watchdog'), 'watchdog');
  const watchdogEnabled = watchdogState === 'healthy';

  const blockedReason = useMemo(() => {
    if (resolvedUrl === '') return t('devboxPage.overviewEndpointMissing');
    if (probeOk) return null;
    if (probeFresh && probeResult !== null && typeof probeResult.error === 'string' && probeResult.error !== '') {
      return probeResult.error;
    }
    if (savedMode === 'cloudflare' && (savedPublicUrl === '' || envValue(entries, 'TUNNEL_TOKEN') === '')) {
      return t('devboxPage.connectCloudflareWarning');
    }
    if (savedMode === 'manual' && savedPublicUrl === '') return t('devboxPage.connectManualUrlHint');
    if (stackState === 'down') return t('devboxPage.overviewHeroStackSub');
    if (bridgeState !== 'healthy') return t('devboxPage.overviewHeroBridgeSub');
    return null;
  }, [resolvedUrl, probeOk, probeFresh, probeResult, savedMode, savedPublicUrl, entries, stackState, bridgeState]);

  const detection = useMemo<DevboxDetection>(() => {
    const publicUrl = (draft.PUBLIC_URL ?? '').trim();
    if (resolvedUrl === '') {
      if (publicUrl === '') return { messageKey: 'devboxPage.connectDetectFill', recommendedMode: null };
      return { messageKey: 'devboxPage.connectDetectBlocked', recommendedMode: 'auto' };
    }
    if (probeOk) return { messageKey: 'devboxPage.connectDetectOk', recommendedMode: null };
    // пока пробы нет или она устарела — рекомендовать нечего, иначе предлагаем
    // перейти на канал, который ещё не проверяли (случай «мёртвый PUBLIC_URL»)
    if (!probeFresh) return { messageKey: 'devboxPage.connectDetectPending', recommendedMode: null };
    if (probeMode !== 'manual' && publicUrl !== '') {
      return { messageKey: 'devboxPage.connectDetectManual', recommendedMode: 'manual' };
    }
    const canAuto = savedRelayUrl !== '' || probeMode === 'relay';
    if (draftMode !== 'auto' && canAuto) {
      return { messageKey: 'devboxPage.connectDetectBlocked', recommendedMode: 'auto' };
    }
    return { messageKey: 'devboxPage.connectDetectBlocked', recommendedMode: null };
  }, [draft.PUBLIC_URL, resolvedUrl, probeOk, probeFresh, probeMode, draftMode, savedRelayUrl]);

  const handoffTokens = useMemo(() => parseHandoffTokens(handoffBlock), [handoffBlock]);
  const tokenRows = useMemo<DevboxTokenRow[]>(
    () =>
      TOKEN_DEFS.map(def => {
        const maskedValue = envValue(entries, def.envKey);
        const parsed = handoffTokens[def.id] ?? '';
        const useParsed = handoffRevealed && parsed !== '';
        const value = useParsed ? parsed : maskedValue;
        return {
          id: def.id,
          envKey: def.envKey,
          labelKey: def.labelKey,
          descKey: def.descKey,
          value,
          masked: !useParsed,
          available: value !== '' && value !== '...',
        };
      }),
    [entries, handoffTokens, handoffRevealed],
  );

  const accessMode = normalizeAccessMode(profileMode);
  const accessPermissions = accessMode === 'custom' ? null : ACCESS_PERMISSIONS[accessMode];
  const denyMounts = useMemo(() => {
    const value = profileModel?.deny_mounts;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }, [profileModel]);
  const permissionsJson = envValue(entries, 'OPENCODE_MCP_PERMISSIONS');
  const timeoutSeconds = Number(draft.JOB_TIMEOUT_SECONDS ?? '');
  const timeoutMinutes =
    Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? Math.round(timeoutSeconds / 60) : 0;
  const egressValue = draft.EGRESS_CONTAINER ?? 'rdm-egress';

  return {
    activeProfile,
    entries,
    draft,
    envLoading,
    envError,
    saving,
    saved,
    errors,
    restartKinds,
    hasChanges,
    setField,
    saveEnv,
    reload,
    profileJson,
    profileModel,
    profileMode,
    profileLoading,
    profileError,
    accessSaving,
    saveAccess,
    accessMode,
    accessPermissions,
    denyMounts,
    permissionsJson,
    timeoutMinutes,
    egressValue,
    savedMode,
    draftMode,
    effectiveMode,
    fallbackActive,
    resolvedUrl,
    bridgeEndpoint,
    connection,
    connectionLoading,
    connectionError,
    connectionStale,
    connectionRevealed: connectionState?.revealed ?? false,
    chatConfig,
    ensureConnectionRevealed,
    bootstrap,
    handoffBlock,
    handoffLoading,
    handoffError,
    handoffRevealed,
    handoffStale,
    loadHandoff,
    ensureHandoffRevealed,
    hideHandoff,
    tokenRows,
    tokensStale: handoffStale,
    ensureTokensRevealed,
    rotateTokens,
    probe,
    probeResult,
    probeOk,
    probeStale,
    checking,
    runCheck,
    tools,
    latency,
    stackState,
    bridgeState,
    ingressState,
    watchdogState,
    watchdogEnabled,
    toggleWatchdog,
    blockedReason,
    detection,
    startStack,
    stopStack,
    restartIngress,
    openCockpit,
    savedPublicUrl,
    savedRelayUrl,
    savedTunnelToken,
  };
}

export type UseDevboxConnectResult = ReturnType<typeof useDevboxConnect>;
