import { useState } from 'react';
import { TestTube, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard, Button, Input, Checkbox } from '@/components/ui';
import { testOpenCodeApi } from '@/lib/tauri/modules/opencodeConfig';

interface ApiTesterSectionProps {
  onAddProvider: (baseUrl: string, apiKey: string, models: string[], providerName: string) => void;
}

export function ApiTesterSection({ onAddProvider }: ApiTesterSectionProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [providerName, setProviderName] = useState('');
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
        toast.success(`Discovered ${result.models.length} models`);
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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">API Tester</h3>
        <p className="text-sm text-vsc-text-muted">
          Test an API endpoint to discover available models
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
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Testing...</>
          ) : (
            <><TestTube className="w-4 h-4 mr-2" /> Test Connection</>
          )}
        </Button>
      </GlassCard>

      {models.length > 0 && (
        <GlassCard className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold">Discovered Models ({models.length})</h4>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(models))}>
                Select All
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 max-h-64 overflow-y-auto">
            {models.map(id => (
              <div
                key={id}
                className="flex items-center gap-2 p-2 rounded hover:bg-vsc-sidebar cursor-pointer"
                onClick={() => toggle(id)}
              >
                <Checkbox checked={selected.has(id)} onChange={() => toggle(id)} />
                <span className="text-sm">{id}</span>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-vsc-border space-y-4">
            <Input
              label="Provider Name *"
              value={providerName}
              onChange={e => setProviderName(e.target.value)}
              placeholder="e.g., My Provider"
            />
            <Button onClick={handleAdd} disabled={selected.size === 0 || !providerName} className="w-full">
              <Plus className="w-4 h-4 mr-2" />
              Add {selected.size} Model{selected.size !== 1 ? 's' : ''}
            </Button>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
