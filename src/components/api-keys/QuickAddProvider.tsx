import { useState } from 'react';
import { CheckCircle2, XCircle, Link as LinkIcon, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { Button, GlassCard, Input, Badge } from '@/components/ui';
import { testOpenCodeApi, type ApiTestResult } from '@/lib/backend/modules/opencodeConfig';
import { addCustomProvider } from '@/lib/backend/modules/customProviders';

interface QuickAddProviderProps {
  isOpen: boolean;
  onClose: () => void;
  onProviderAdded: (providerId: string, baseUrl: string) => void;
}

export function QuickAddProvider({ isOpen, onClose, onProviderAdded }: QuickAddProviderProps) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ApiTestResult | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const canTest = name.trim().length > 0 && baseUrl.trim().length > 0;
  const canAdd = name.trim().length > 0 && baseUrl.trim().length > 0;

  const handleTest = async () => {
    if (!canTest) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testOpenCodeApi(baseUrl.trim(), 'test');
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleAdd = async () => {
    if (!canAdd) return;
    setIsAdding(true);
    try {
      const result = await addCustomProvider(name.trim(), baseUrl.trim(), 'openai/*');
      if (result.success && result.provider) {
        toast.success(`Provider "${name.trim()}" added`);
        onProviderAdded(result.provider.id, baseUrl.trim());
        // Reset form
        setName('');
        setBaseUrl('');
        setTestResult(null);
      } else {
        toast.error(result.error || 'Failed to add provider');
      }
    } catch (error) {
      toast.error(`Failed to add provider: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsAdding(false);
    }
  };

  const handleCancel = () => {
    setName('');
    setBaseUrl('');
    setTestResult(null);
    onClose();
  };

  if (!isOpen) return null;

  const models = testResult?.models ?? [];
  const previewModels = models.slice(0, 10);
  const hasMore = models.length > 10;

  return (
    <GlassCard className="p-4 space-y-4 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-2">
        <LinkIcon className="w-4 h-4 text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-200">Quick Add</h3>
      </div>

      {/* Name */}
      <Input
        label="Name"
        placeholder="DashScope (Alibaba)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={isAdding}
      />

      {/* Base URL */}
      <Input
        label="Base URL"
        placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        disabled={isAdding}
      />

      {/* Test Connection */}
      <Button
        variant="secondary"
        size="sm"
        onClick={handleTest}
        disabled={!canTest || isTesting || isAdding}
        isLoading={isTesting}
        leftIcon={isTesting ? undefined : <ExternalLink className="w-3.5 h-3.5" />}
      >
        Test Connection
      </Button>

      {/* Test Result */}
      {testResult && (
        <div
          className={cn(
            'rounded-lg border p-3 space-y-2',
            testResult.success
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-red-500/20 bg-red-500/5'
          )}
        >
          <div className="flex items-center gap-2">
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400 shrink-0" />
            )}
            <span
              className={cn(
                'text-sm font-medium',
                testResult.success ? 'text-emerald-300' : 'text-red-300'
              )}
            >
              {testResult.success ? 'Connected successfully' : 'Connection failed'}
            </span>
          </div>

          {testResult.success && models.length > 0 && (
            <>
              <p className="text-xs text-slate-400">
                {models.length} model{models.length !== 1 ? 's' : ''} available
              </p>
              <div className="flex flex-wrap gap-1">
                {previewModels.map((m) => (
                  <Badge key={m.id} variant="info" size="sm">
                    {m.id}
                  </Badge>
                ))}
                {hasMore && (
                  <Badge variant="outline" size="sm">
                    +{models.length - 10} more
                  </Badge>
                )}
              </div>
            </>
          )}

          {testResult.error && (
            <p className="text-xs text-red-400/80">{testResult.error}</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={handleCancel} disabled={isAdding}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleAdd}
          disabled={!canAdd || isAdding}
          isLoading={isAdding}
          rightIcon={isAdding ? undefined : <ExternalLink className="w-3.5 h-3.5" />}
        >
          Add Provider &amp; Keys →
        </Button>
      </div>
    </GlassCard>
  );
}