import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import { devboxHandoffBlock, type DevboxHandoffBlock } from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';

const STALE_COMMAND_RE = /method not found|-32601/i;

export function DevboxHandoff({ reloadTick = 0 }: { reloadTick?: number }) {
  const [data, setData] = useState<DevboxHandoffBlock | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [task, setTask] = useState('');
  const [fullBlock, setFullBlock] = useState<string | null>(null);
  const revealedRef = useRef(false);

  const load = useCallback((reveal: boolean) => {
    devboxHandoffBlock(reveal)
      .then(result => {
        setData(result);
        setError(null);
        setRevealed(reveal);
        revealedRef.current = reveal;
        if (reveal) setFullBlock(result.block);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (reloadTick > 0) load(revealedRef.current);
  }, [reloadTick, load]);

  const copyPrompt = async () => {
    let block = fullBlock;
    if (block === null) {
      try {
        const result = await devboxHandoffBlock(true);
        block = result.block;
        setFullBlock(block);
      } catch {
        appToast.error(t('pluginUi.actionFailed'));
        return;
      }
    }
    const closer =
      task.trim() !== ''
        ? `\n\n${t('devboxPage.handoffTaskHeader')}\n${task}`
        : `\n\n${t('devboxPage.handoffNoTask')}`;
    try {
      await navigator.clipboard.writeText(
        `${t('devboxPage.handoffPromptIntro')}\n\n${block}${closer}`,
      );
      appToast.success(t('pluginUi.copied'));
    } catch {
      appToast.error(t('pluginUi.actionFailed'));
    }
  };

  const errorText =
    error !== null && STALE_COMMAND_RE.test(error) ? t('devboxPage.handoffErrorStale') : error;

  return (
    <DevboxSection
      title={t('devboxPage.sectionHandoff')}
      caption={t('devboxPage.handoffCaption')}
      error={errorText}
      onRetry={() => load(revealed)}
      testId="devbox-handoff"
      actions={
        <IconButton
          size="sm"
          variant="ghost"
          aria-label={t('common.refresh')}
          tooltip={t('devboxPage.tipRefreshHandoff')}
          data-testid="devbox-handoff-refresh"
          onClick={() => load(revealed)}
        >
          <RefreshCw size={14} />
        </IconButton>
      }
    >
      {data && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {data.masked && (
              <Badge variant="warning" size="sm" data-testid="devbox-handoff-masked">
                {t('devboxPage.handoffMasked')}
              </Badge>
            )}
            <Button
              size="xs"
              variant="outline"
              leftIcon={revealed ? <EyeOff size={14} /> : <Eye size={14} />}
              data-testid="devbox-handoff-reveal"
              onClick={() => load(!revealed)}
            >
              {revealed ? t('devboxPage.handoffHide') : t('devboxPage.handoffReveal')}
            </Button>
            <Button
              size="xs"
              variant="secondary"
              leftIcon={<Copy size={14} />}
              data-testid="devbox-handoff-copy"
              onClick={() => void copyPrompt()}
            >
              {t('devboxPage.handoffCopyPrompt')}
            </Button>
          </div>

          <pre
            data-testid="devbox-handoff-block"
            className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-xs text-slate-300 whitespace-pre-wrap break-words"
          >
            {data.block}
          </pre>

          <Textarea
            rows={4}
            value={task}
            placeholder={t('devboxPage.handoffTaskPlaceholder')}
            data-testid="devbox-handoff-task"
            onChange={e => setTask(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              data-testid="devbox-handoff-template"
              onClick={() => setTask(t('devboxPage.handoffTaskTemplate'))}
            >
              {t('devboxPage.handoffTemplate')}
            </Button>
          </div>
        </div>
      )}
    </DevboxSection>
  );
}
