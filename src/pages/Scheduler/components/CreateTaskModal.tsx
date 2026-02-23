import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Input, Select, Modal } from '../../../components/ui';
import { useSchedulerStore } from '../../../stores/scheduler';
import type { TaskType, Schedule } from '../../../types/generated';

interface CreateTaskModalProps {
  onClose: () => void;
}

export function CreateTaskModal({ onClose }: CreateTaskModalProps) {
  const { createTask } = useSchedulerStore();

  const [name, setName] = useState('');
  const [taskTypeOption, setTaskTypeOption] = useState<'register' | 'login' | 'refresh' | 'script'>('register');
  const [scheduleType, setScheduleType] = useState<'once' | 'interval' | 'daily'>('interval');
  
  // Task type specific fields
  const [provider, setProvider] = useState('');
  const [accountId, setAccountId] = useState('');
  const [scriptPath, setScriptPath] = useState('');
  
  // Schedule specific fields
  const [timestamp, setTimestamp] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState('3600');
  const [hour, setHour] = useState('9');
  const [minute, setMinute] = useState('0');
  
  const [config, setConfig] = useState('{}');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      // Build task type
      let taskType: TaskType;
      switch (taskTypeOption) {
        case 'register':
          taskType = { registerProvider: { provider } };
          break;
        case 'login':
          taskType = { loginAccount: { account_id: parseInt(accountId) } };
          break;
        case 'refresh':
          taskType = { refreshToken: { account_id: parseInt(accountId) } };
          break;
        case 'script':
          taskType = { customScript: { script_path: scriptPath } };
          break;
      }

      // Build schedule
      let schedule: Schedule;
      switch (scheduleType) {
        case 'once':
          schedule = { once: { timestamp: new Date(timestamp).getTime() / 1000 } };
          break;
        case 'interval':
          schedule = { interval: { seconds: parseInt(intervalSeconds) } };
          break;
        case 'daily':
          schedule = { daily: { hour: parseInt(hour), minute: parseInt(minute) } };
          break;
      }

      await createTask(name, taskType, schedule, config);
      onClose();
    } catch (error) {
      console.error('Failed to create task:', error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Create Scheduled Task"
      icon={<Plus className="text-vsc-blue" size={20} />}
      size="lg"
      isLoading={submitting}
      loadingMessage="Creating task..."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
            Create Task
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-vsc-text mb-1">Task Details</h3>
            <p className="text-xs text-vsc-text-muted">Basic information about the task</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-vsc-text mb-2">Task Name</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Daily AWS Registration"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-vsc-text mb-2">Task Type</label>
              <Select
                value={taskTypeOption}
                onChange={e => setTaskTypeOption(e.target.value as any)}
              >
                <option value="register">Register Provider</option>
                <option value="login">Login Account</option>
                <option value="refresh">Refresh Token</option>
                <option value="script">Custom Script</option>
              </Select>
            </div>

            {taskTypeOption === 'register' && (
              <div>
                <label className="block text-sm font-medium text-vsc-text mb-2">Provider</label>
                <Select value={provider} onChange={e => setProvider(e.target.value)} required>
                  <option value="">Select provider...</option>
                  <option value="aws">AWS</option>
                  <option value="github">GitHub</option>
                  <option value="openai">OpenAI</option>
                  <option value="kiro">Kiro</option>
                  <option value="windsurf">Windsurf</option>
                </Select>
              </div>
            )}

            {(taskTypeOption === 'login' || taskTypeOption === 'refresh') && (
              <div>
                <label className="block text-sm font-medium text-vsc-text mb-2">Account ID</label>
                <Input
                  type="number"
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder="Account ID"
                  required
                />
              </div>
            )}

            {taskTypeOption === 'script' && (
              <div>
                <label className="block text-sm font-medium text-vsc-text mb-2">Script Path</label>
                <Input
                  value={scriptPath}
                  onChange={e => setScriptPath(e.target.value)}
                  placeholder="/path/to/script.py"
                  required
                />
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-vsc-text mb-1">Schedule</h3>
            <p className="text-xs text-vsc-text-muted">When should this task run</p>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-vsc-text mb-2">Schedule Type</label>
              <Select
                value={scheduleType}
                onChange={e => setScheduleType(e.target.value as any)}
              >
                <option value="interval">Interval</option>
                <option value="daily">Daily</option>
                <option value="once">Once</option>
              </Select>
            </div>

            {scheduleType === 'once' && (
              <div>
                <label className="block text-sm font-medium text-vsc-text mb-2">Date & Time</label>
                <Input
                  type="datetime-local"
                  value={timestamp}
                  onChange={e => setTimestamp(e.target.value)}
                  required
                />
              </div>
            )}

            {scheduleType === 'interval' && (
              <div>
                <label className="block text-sm font-medium text-vsc-text mb-2">Interval (seconds)</label>
                <Input
                  type="number"
                  value={intervalSeconds}
                  onChange={e => setIntervalSeconds(e.target.value)}
                  placeholder="3600"
                  required
                />
                <p className="text-xs text-vsc-text-muted mt-1">
                  Examples: 3600 = 1 hour, 86400 = 1 day
                </p>
              </div>
            )}

            {scheduleType === 'daily' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-vsc-text mb-2">Hour (0-23)</label>
                  <Input
                    type="number"
                    min="0"
                    max="23"
                    value={hour}
                    onChange={e => setHour(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-vsc-text mb-2">Minute (0-59)</label>
                  <Input
                    type="number"
                    min="0"
                    max="59"
                    value={minute}
                    onChange={e => setMinute(e.target.value)}
                    required
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-vsc-text mb-1">Configuration</h3>
            <p className="text-xs text-vsc-text-muted">Optional JSON configuration</p>
          </div>
          <div>
            <textarea
              className="w-full px-3 py-2 bg-vsc-input border border-vsc-border rounded-lg text-vsc-text font-mono text-sm"
              rows={4}
              value={config}
              onChange={e => setConfig(e.target.value)}
              placeholder='{"key": "value"}'
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
