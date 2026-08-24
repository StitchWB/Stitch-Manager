/**
 * SandboxPlayground — power-user command tester for a sandbox plugin.
 *
 * Invokes the namespaced route `POST /api/plugin.{plugin_id}.{command}` with
 * an arbitrary JSON body and renders the raw outcome. Unlike `safeInvoke`,
 * which wraps non-2xx responses in a `BackendError` and discards the HTTP
 * status, a playground must surface the status code + body verbatim — so it
 * issues the same fetch the core invoke uses (same base URL, credentials,
 * JSON content type) without the error-wrapping layer.
 */
import { useCallback, useState } from 'react';
import { Play, Loader2, Info } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { getApiBaseUrl } from '@/lib/backend/core/url';

interface ExecResult {
  ok: boolean;
  status: number;
  body: string;
}

export interface SandboxPlaygroundProps {
  pluginId: string;
}

export function SandboxPlayground({ pluginId }: SandboxPlaygroundProps) {
  const [command, setCommand] = useState('');
  const [paramsText, setParamsText] = useState('{}');
  const [executing, setExecuting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecResult | null>(null);

  const onExecute = useCallback(async () => {
    setValidationError(null);
    setResult(null);

    const cmd = command.trim();
    if (!cmd) {
      setValidationError(t('admin.plugins.sandbox.playground.commandRequired'));
      return;
    }

    // Parse params client-side; refuse invalid JSON (or a non-object body).
    let params: Record<string, unknown>;
    try {
      const parsed: unknown = paramsText.trim() === '' ? {} : JSON.parse(paramsText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('params must be a JSON object');
      }
      params = parsed as Record<string, unknown>;
    } catch {
      setValidationError(t('admin.plugins.sandbox.playground.invalidJson'));
      return;
    }

    setExecuting(true);
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/plugin.${pluginId}.${cmd}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const text = await response.text();
      // Pretty-print when the body is JSON; otherwise show it verbatim.
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* not JSON — keep raw text */
      }
      setResult({ ok: response.ok, status: response.status, body });
    } catch {
      setResult({ ok: false, status: 0, body: t('admin.plugins.sandbox.playground.networkError') });
    } finally {
      setExecuting(false);
    }
  }, [command, paramsText, pluginId]);

  return (
    <div className="mt-2 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.03] p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Play className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-xs font-semibold text-indigo-200">
          {t('admin.plugins.sandbox.playground.title')}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label={t('admin.plugins.sandbox.playground.command')}
            value={command}
            onChange={e => setCommand(e.target.value)}
            placeholder="echo"
            disabled={executing}
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void onExecute()}
          disabled={executing}
          leftIcon={executing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
        >
          {t('admin.plugins.sandbox.playground.execute')}
        </Button>
      </div>

      <Textarea
        label={t('admin.plugins.sandbox.playground.params')}
        value={paramsText}
        onChange={e => setParamsText(e.target.value)}
        placeholder="{}"
        disabled={executing}
        className="font-mono text-xs min-h-[64px]"
      />

      {validationError && (
        <p className="text-xs text-red-400">{validationError}</p>
      )}

      {result && (
        <div className="rounded-lg border border-white/[0.06] bg-black/60 p-3">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={
                result.ok
                  ? 'text-[11px] font-mono font-semibold text-emerald-300'
                  : 'text-[11px] font-mono font-semibold text-red-400'
              }
            >
              {result.status}
            </span>
            <span className="text-[11px] text-slate-500">
              {result.ok
                ? t('admin.plugins.sandbox.playground.response')
                : t('admin.plugins.sandbox.playground.error')}
            </span>
          </div>
          <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
            {result.body}
          </pre>
        </div>
      )}

      <div className="flex items-start gap-2 text-[11px] text-slate-500">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        <div className="flex flex-col gap-1">
          <span>{t('admin.plugins.sandbox.playground.idleHint')}</span>
          <span>{t('admin.plugins.sandbox.playground.shadowHint')}</span>
        </div>
      </div>
    </div>
  );
}
