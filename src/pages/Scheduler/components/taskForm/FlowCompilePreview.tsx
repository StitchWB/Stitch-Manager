import { useCallback, useMemo, useState } from 'react';
import { t } from '@/lib/i18n';

import { compileComposedFlow } from '../../../../lib/scenarioFlow/compiler';
import { Button } from '@/components/ui';
import { parseFlowObject } from './flowUtils';

interface FlowCompilePreviewProps {
  composedFlowJson: string;
}

export function FlowCompilePreview({ composedFlowJson }: FlowCompilePreviewProps) {
  const [compileCheck, setCompileCheck] = useState<{
    ok: boolean;
    message: string;
    segments: Array<{ index: number; alias: string; name: string; scenarioPath: string }>;
    diagnostics: string[];
  } | null>(null);

  const parsedFlow = useMemo(() => parseFlowObject(composedFlowJson), [composedFlowJson]);

  const compiledFlowPreview = useMemo(
    () => (parsedFlow ? compileComposedFlow(parsedFlow) : null),
    [parsedFlow]
  );

  const runCompileCheck = useCallback(() => {
    if (!parsedFlow) {
      setCompileCheck({
        ok: false,
        message: t('scheduler.flowJsonInvalid'),
        segments: [],
        diagnostics: [t('scheduler.provideValidFlowJson')],
      });
      return;
    }

    const compiled = compileComposedFlow(parsedFlow);
    setCompileCheck({
      ok: compiled.diagnostics.length === 0 && compiled.segments.length > 0,
      message:
        compiled.segments.length > 0
          ? `Compiled ${compiled.segments.length} runnable segment(s)`
          : t('scheduler.noRunnableSegments'),
      segments: compiled.segments.map(seg => ({
        index: seg.index,
        alias: seg.alias,
        name: seg.name,
        scenarioPath: seg.scenarioPath,
      })),
      diagnostics: compiled.diagnostics,
    });
  }, [parsedFlow]);

  return (
    <div className="rounded-md border border-vsc-border bg-vsc-input/20 p-3 text-xs space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-vsc-text-muted">{t('scheduler.composedFlowPreview')}</div>
        <Button variant="secondary" size="sm" onClick={runCompileCheck}>
          {t('scheduler.testCompile')}
        </Button>
      </div>
      {parsedFlow ? (
        <>
          <div>{t('scheduler.flowName')} {parsedFlow.name || t('scheduler.unnamed')}</div>
          <div>{t('scheduler.flowNodes')} {parsedFlow.nodes.length}</div>
          <div>
            {t('scheduler.runnableSegments')} {compiledFlowPreview?.segments.length ?? 0} • {t('scheduler.diagnostics')}{' '}
            {compiledFlowPreview?.diagnostics.length ?? 0}
          </div>
        </>
      ) : (
        <div className="text-vsc-muted">{t('scheduler.provideValidFlowJsonPreview')}</div>
      )}

      {compileCheck ? (
        <div className="mt-2 rounded-md border border-vsc-border bg-vsc-input/20 p-2 space-y-1">
          <div className={compileCheck.ok ? 'text-green-400' : 'text-amber-300'}>
            {compileCheck.message}
          </div>
          {compileCheck.diagnostics.length > 0 ? (
            <div className="text-amber-300">
              {compileCheck.diagnostics.map(item => (
                <div key={item}>• {item}</div>
              ))}
            </div>
          ) : null}
          {compileCheck.segments.length > 0 ? (
            <div className="text-vsc-muted">
              {compileCheck.segments.map(seg => (
                <div key={`${seg.index}:${seg.scenarioPath}`}>
                  #{seg.index} [{seg.alias}] {seg.name} → {seg.scenarioPath}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
