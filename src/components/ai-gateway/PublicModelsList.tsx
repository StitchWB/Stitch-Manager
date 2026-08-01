import { useEffect } from 'react';
import { Plus, Trash2, Edit2, Globe, RotateCw } from 'lucide-react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { PublicModel } from '@/lib/backend/modules/aiGateway';
import { Button, Badge } from '@/components/ui';

interface PublicModelsListProps {
  onAddModel: () => void;
  onEditModel: (model: PublicModel) => void;
  onSelectModel: (model: PublicModel) => void;
}

export function PublicModelsList({ onAddModel, onEditModel, onSelectModel }: PublicModelsListProps) {
  const { publicModels, loading, errors, fetchPublicModels, deletePublicModel } = useAiGatewayStore();

  useEffect(() => {
    fetchPublicModels();
  }, [fetchPublicModels]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this public model and all its route targets?')) {
      await deletePublicModel(id);
    }
  };

  if (loading.publicModels) {
    return <div className="p-4 text-center text-slate-400">Loading models...</div>;
  }

  if (errors.publicModels) {
    return (
      <div className="p-4 text-center text-red-400">
        <div className="mb-2">Error: {errors.publicModels}</div>
        <Button size="sm" variant="outline" onClick={() => fetchPublicModels()}>
          <RotateCw className="h-4 w-4 mr-2" />Retry
        </Button>
      </div>
    );
  }

  if (publicModels.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-lg p-8 text-center">
        <Globe className="mx-auto h-12 w-12 text-slate-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Public Models</h3>
        <p className="text-slate-400 mb-4">Create public model aliases to expose to clients</p>
        <Button onClick={onAddModel}><Plus className="h-4 w-4 mr-2" />Add Public Model</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Public Models</h2>
        <Button size="sm" onClick={onAddModel}><Plus className="h-4 w-4 mr-2" />Add Model</Button>
      </div>

      {publicModels.map(model => (
        <div
          key={model.id}
          className="bg-white/5 border border-white/10 rounded-lg p-4 cursor-pointer hover:bg-white/10 transition-colors"
          onClick={() => onSelectModel(model)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <Globe className="h-5 w-5 text-slate-400" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold truncate">{model.id}</h3>
                  {model.enabled && <Badge variant="success">Enabled</Badge>}
                </div>
                {model.displayName && (
                  <div className="text-sm text-slate-400">{model.displayName}</div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); onEditModel(model); }}>
                <Edit2 className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={e => handleDelete(e, model.id)}>
                <Trash2 className="h-4 w-4 text-red-400" />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
