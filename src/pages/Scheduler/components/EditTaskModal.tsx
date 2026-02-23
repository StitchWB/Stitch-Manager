import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button, Input, Toggle } from '../../../components/ui';
import { useSchedulerStore } from '../../../stores/scheduler';

interface EditTaskModalProps {
  taskId: number;
  onClose: () => void;
}

export function EditTaskModal({ taskId, onClose }: EditTaskModalProps) {
  const { tasks, updateTask } = useSchedulerStore();
  const task = tasks.find(t => t.id === taskId);

  const [name, setName] = useState(task?.name || '');
  const [enabled, setEnabled] = useState(task?.enabled || false);
  const [config, setConfig] = useState(task?.config || '{}');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (task) {
      setName(task.name);
      setEnabled(task.enabled);
      setConfig(task.config);
    }
  }, [task]);

  if (!task) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      await updateTask({
        ...task,
        name,
        enabled,
        config,
      });
      onClose();
    } catch (error) {
      console.error('Failed to update task:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-vsc-sidebar border border-vsc-border rounded-lg w-full max-w-2xl">
        <div className="flex items-center justify-between p-4 border-b border-vsc-border">
          <h2 className="text-lg font-semibold text-vsc-text">Edit Task</h2>
          <button onClick={onClose} className="text-vsc-text-muted hover:text-vsc-text">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-vsc-text mb-2">Task Name</label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-vsc-text mb-2">Enabled</label>
            <Toggle label="Task enabled" checked={enabled} onChange={setEnabled} />
          </div>

          <div>
            <label className="block text-sm font-medium text-vsc-text mb-2">
              Config (JSON)
            </label>
            <textarea
              className="w-full px-3 py-2 bg-vsc-input border border-vsc-border rounded-lg text-vsc-text font-mono text-sm"
              rows={6}
              value={config}
              onChange={e => setConfig(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="secondary" onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
