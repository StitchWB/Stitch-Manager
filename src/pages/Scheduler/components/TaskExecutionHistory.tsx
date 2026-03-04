import { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Button, EmptyState } from '../../../components/ui';
import { useSchedulerStore } from '../../../stores/scheduler';
import type { TaskExecution } from '../../../types/generated';
import { formatDistanceToNow } from 'date-fns';

interface TaskExecutionHistoryProps {
  taskId: number;
  onClose: () => void;
}

export function TaskExecutionHistory({ taskId, onClose }: TaskExecutionHistoryProps) {
  const { getExecutions } = useSchedulerStore();
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadExecutions = async () => {
      setLoading(true);
      const data = await getExecutions(taskId, 50);
      setExecutions(data);
      setLoading(false);
    };
    void loadExecutions();
  }, [getExecutions, taskId]);

  const getStatusIcon = (status: string) => {
    if (status === 'Success') return <CheckCircle size={16} className="text-vsc-green" />;
    if (status === 'Failed') return <XCircle size={16} className="text-vsc-red" />;
    return <Clock size={16} className="text-vsc-yellow" />;
  };

  const getStatusColor = (status: string) => {
    if (status === 'Success') return 'text-vsc-green';
    if (status === 'Failed') return 'text-vsc-red';
    return 'text-vsc-yellow';
  };

  const formatDuration = (startedAt: number, completedAt: number | null) => {
    if (!completedAt) return 'Running...';
    const duration = completedAt - startedAt;
    if (duration < 60) return `${duration}s`;
    return `${Math.floor(duration / 60)}m ${duration % 60}s`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-vsc-sidebar border border-vsc-border rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-vsc-border">
          <h2 className="text-lg font-semibold text-vsc-text">Execution History</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-vsc-text-muted hover:text-vsc-text"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-vsc-text-muted">Loading history...</div>
            </div>
          ) : executions.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No execution history"
              description="This task hasn't been executed yet"
            />
          ) : (
            <div className="space-y-2">
              {executions.map(execution => (
                <div
                  key={execution.id}
                  className="bg-vsc-bg border border-vsc-border rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(execution.status)}
                      <span className={`font-medium ${getStatusColor(execution.status)}`}>
                        {execution.status}
                      </span>
                    </div>
                    <div className="text-sm text-vsc-text-muted">
                      {formatDistanceToNow(new Date(execution.startedAt * 1000), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm mb-2">
                    <div>
                      <span className="text-vsc-text-muted">Started:</span>
                      <span className="ml-2 text-vsc-text">
                        {new Date(execution.startedAt * 1000).toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-vsc-text-muted">Duration:</span>
                      <span className="ml-2 text-vsc-text">
                        {formatDuration(execution.startedAt, execution.completedAt)}
                      </span>
                    </div>
                  </div>

                  {execution.result && (
                    <div className="mt-2 p-2 bg-vsc-input rounded text-xs text-vsc-text font-mono">
                      {execution.result}
                    </div>
                  )}

                  {execution.error && (
                    <div className="mt-2 p-2 bg-vsc-red/10 border border-vsc-red/20 rounded text-xs text-vsc-red">
                      {execution.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end p-4 border-t border-vsc-border">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
