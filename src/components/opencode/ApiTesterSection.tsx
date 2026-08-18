import { useState } from 'react';
import { t } from '@/lib/i18n';
import { TestTube, Plus, Loader2, Eye, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard, Button, Input, Checkbox, Badge, Textarea, StatusBadge } from '@/components/ui';
import { testOpenCodeApi, bulkTestOpenCodeApi, type BulkTestKeyResult } from '@/lib/backend/modules/opencodeConfig';
import { setOpenAIApiKeys } from '@/lib/backend/modules/apiKeys';

type ModelInfo = {
  id: string;
  owned_by?: string;
  vision?: boolean;
  status?: 'stable' | 'experimental';
};

interface ApiTesterSectionProps {
  onAddProvider: (baseUrl: string, apiKey: string, models: string[], providerName: string) => void;
}

export function ApiTesterSection({ onAddProvider }: ApiTesterSectionProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [providerName, setProviderName] = useState('');
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bulk test state
  const [bulkKeysText, setBulkKeysText] = useState('');
  const [bulkTesting, setBulkTesting] = useState(false);
  const [bulkResults, setBulkResults] = useState<BulkTestKeyResult[]>([]);
  const [bulkImporting, setBulkImporting] = useState(false);

  const handleTest = async () => {
    if (!baseUrl || !apiKey) {
      toast.error('Base URL and API Key required');
      return;
    }
    setTesting(true);
    setModels([]);
    setSelected(new Set());
    try {
      const result = await testOpenCodeApi(baseUrl, apiKey);
      if (result.success && result.models) {
        setModels(result.models);
        toast.success(t('opencode.ui.discoveredToast', { count: result.models.length }));
      } else {
        toast.error(result.error || 'API test failed');
      }
    } catch (error) {
      toast.error('API test failed');
      console.error(error);
    } finally {
      setTesting(false);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const handleAdd = () => {
    if (!providerName) { toast.error('Provider name required'); return; }
    if (selected.size === 0) { toast.error('Select at least one model'); return; }
    onAddProvider(baseUrl, apiKey, Array.from(selected), providerName);
    setBaseUrl(''); setApiKey(''); setProviderName('');
    setModels([]); setSelected(new Set());
  };

  // Bulk test handlers
  const handleBulkTest = async () => {
    if (!baseUrl) { toast.error('Base URL required'); return; }
    const keys = bulkKeysText.split('\n').map(k => k.trim()).filter(Boolean);
    if (keys.length === 0) { toast.error('No keys provided'); return; }

    setBulkTesting(true);
    setBulkResults([]);
    try {
      const result = await bulkTestOpenCodeApi(baseUrl, keys);
      if (result.success && result.results) {
        setBulkResults(result.results);
        const okCount = result.results.filter(r => r.status === 'ok').length;
        toast.success(`Tested ${result.results.length} keys: ${okCount} working`);
      } else {
        toast.error(result.error || 'Bulk test failed');
      }
    } catch (error) {
      toast.error('Bulk test failed');
      console.error(error);
    } finally {
      setBulkTesting(false);
    }
  };

  const handleBulkImport = async () => {
    const workingKeys = bulkResults.filter(r => r.status === 'ok').map(r => r.key);
    if (workingKeys.length === 0) { toast.error('No working keys to import'); return; }

    setBulkImporting(true);
    try {
      const keys = workingKeys.map(k => ({ apiKey: k, baseUrl: baseUrl || null }));
      await setOpenAIApiKeys(keys);
      toast.success(`Imported ${workingKeys.length} keys`);
      setBulkResults([]);
      setBulkKeysText('');
    } catch (error) {
      toast.error('Import failed');
      console.error(error);
    } finally {
      setBulkImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">{t('opencode.ui.testerTitle')}</h3>
          <p className="text-sm text-vsc-text-muted">
            {t('opencode.ui.testerDesc')}
          </p>
      </div>

      <GlassCard className="p-6 space-y-4">
        <Input
          label="Base URL *"
          value={baseUrl}
          onChange={e => setBaseUrl(e.target.value)}
          placeholder="https://api.openai.com/v1"
        />
        <Input
          label="API Key *"
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="sk-..."
        />
        <Button onClick={handleTest} disabled={testing || !baseUrl || !apiKey} className="w-full">
          {testing ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('opencode.ui.testing')}</>
          ) : (
            <><TestTube className="w-4 h-4" /> {t('opencode.buttons.testConnection')}</>
          )}
        </Button>
      </GlassCard>

      {models.length > 0 && (
        <GlassCard className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">{t('opencode.ui.discoveredModels', { count: models.length })}</h4>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(models.map(m => m.id)))}>
                {t('opencode.buttons.selectAll')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                {t('opencode.ui.clear')}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 max-h-64 overflow-y-auto">
            {models.map(model => (
              <div
                key={model.id}
                className="flex items-center gap-2 p-2 rounded hover:bg-vsc-sidebar cursor-pointer"
                onClick={() => toggle(model.id)}
              >
                <Checkbox checked={selected.has(model.id)} onChange={() => toggle(model.id)} />
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm truncate">{model.id}</span>
                  {model.vision && <Eye className="w-3 h-3 text-blue-400 flex-shrink-0" />}
                  {model.status === 'experimental' && (
                    <Badge variant="warning" size="sm">{t('opencode.ui.exp')}</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-vsc-border space-y-4">
            <Input
              label={t('opencode.ui.providerName')}
              value={providerName}
              onChange={e => setProviderName(e.target.value)}
              placeholder={t('opencode.ui.phProviderName')}
            />
            <Button onClick={handleAdd} disabled={selected.size === 0 || !providerName} className="w-full">
              <Plus className="w-4 h-4" />
              {t('opencode.buttons.addSelectedModels', { count: selected.size })}
            </Button>
          </div>
        </GlassCard>
      )}

      {/* Bulk test section */}
      <GlassCard className="p-6 space-y-4">
        <div>
          <h4 className="font-semibold">{t('opencode.ui.bulkTest')}</h4>
          <p className="text-sm text-vsc-text-muted">
            {t('opencode.ui.bulkTestDesc')}
          </p>
        </div>

        <Textarea
          label={t('opencode.ui.apiKeys')}
          value={bulkKeysText}
          onChange={e => setBulkKeysText(e.target.value)}
          placeholder={"sk-...\nsk-...\nsk-..."}
          rows={4}
        />

        <Button
          onClick={handleBulkTest}
          disabled={bulkTesting || !bulkKeysText.trim() || !baseUrl}
          className="w-full"
        >
          {bulkTesting ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('opencode.ui.testing')}</>
          ) : (
            <><TestTube className="w-4 h-4" /> {t('opencode.ui.bulkTest')}</>
          )}
        </Button>

        {/* Bulk results */}
        {bulkResults.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-vsc-border">
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-medium">
                {t('opencode.ui.results', { count: bulkResults.length })}
              </h5>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBulkImport}
                disabled={bulkImporting || bulkResults.filter(r => r.status === 'ok').length === 0}
              >
                {bulkImporting ? (
                  <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> {t('opencode.ui.importing')}</>
                ) : (
                  <><Upload className="w-3 h-3 mr-1" /> {t('opencode.ui.importWorking')}</>
                )}
              </Button>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1">
              {bulkResults.map((result, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm p-2 rounded bg-vsc-sidebar">
                  <span className="font-mono text-xs truncate">
                    ...{result.key.slice(-8)}
                  </span>
                  <StatusBadge
                    status={
                      result.status === 'ok' ? 'success' :
                      result.status === 'rate_limited' ? 'warning' : 'error'
                    }
                    size="sm"
                  >
                    {result.status === 'ok' ? 'OK' :
                     result.status === 'rate_limited' ? 'Rate Limited' :
                     result.status === 'invalid' ? 'Invalid' : 'Error'}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
