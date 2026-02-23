import { useState, useEffect } from 'react';
import { Plus, Play, Pause, Trash2, Edit, Clock, Calendar, Zap, TrendingUp } from 'lucide-react';
import {
  Button,
  IconButton,
  Toggle,
  EmptyState,
  GlassCard,
  StatCard,
  StatusBadge,
  ProgressBar,
} from '../components/ui';
import { useSchedulerStore } from '../stores/scheduler';
import { TaskType, Schedule } from '../types/generated';
import { CreateTaskModal } from './Scheduler/components/CreateTaskModal';
import { EditTaskModal } from './Scheduler/components/EditTaskModal';
import { TaskExecutionHistory } from './Scheduler/components/TaskExecutionHistory';
import { formatDistanceToNow } from 'date-fns';

export default function Scheduler() {
  const {
    tasks,
    isRunning,
    loading,
    fetchTasks,
    toggleTask,
    deleteTask,
    executeNow,
    startScheduler,
    stopScheduler,
    getSchedulerStatus,
  } = useSchedulerStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<number | null>(null);
  const [viewingHistory, setViewingHistory] = useState<number | null>(null);

  useEffect(() => {
    fetchTasks();
    getSchedulerStatus();

    // Poll status every 10 seconds
    const interval = setInterval(() => {
      getSchedulerStatus();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleToggleScheduler = async () => {
    if (isRunning) {
      await stopScheduler();
    } else {
      await startScheduler();
    }
  };

  const handleToggleTask = async (taskId: number, enabled: boolean) => {
    await toggleTask(taskId, enabled);
  };

  const handleDeleteTask = async (taskId: number) => {
    if (confirm('Are you sure you want to delete this task?')) {
      await deleteTask(taskId);
    }
  };

  const handleExecuteNow = async (taskId: number) => {
    await executeNow(taskId);
  };

  const getTaskTypeLabel = (taskType: TaskType): string => {
    if ('registerProvider' in taskType) {
      return `Register ${taskType.registerProvider.provider}`;
    }
    if ('loginAccount' in taskType) {
      return `Login Account #${taskType.loginAccount.account_id}`;
    }
    if ('refreshToken' in taskType) {
      return `Refresh Token #${taskType.refreshToken.account_id}`;
    }
    if ('customScript' in taskType) {
      return `Script: ${taskType.customScript.script_path}`;
    }
    return 'Unknown';
  };

  const getScheduleLabel = (schedule: Schedule): string => {
    if ('once' in schedule) {
      return `Once at ${new Date(schedule.once.timestamp * 1000).toLocaleString()}`;
    }
    if ('interval' in schedule) {
      const hours = Math.floor(schedule.interval.seconds / 3600);
      const minutes = Math.floor((schedule.interval.seconds % 3600) / 60);
      if (hours > 0) {
        return `Every ${hours}h ${minutes}m`;
      }
      return `Every ${minutes}m`;
    }
    if ('daily' in schedule) {
      return `Daily at ${schedule.daily.hour.toString().padStart(2, '0')}:${schedule.daily.minute.toString().padStart(2, '0')}`;
    }
    if ('afterTask' in schedule) {
      return `After task #${schedule.afterTask.task_id} + ${schedule.afterTask.delay_seconds}s`;
    }
    return 'Unknown';
  };

  const getNextRunLabel = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    
    if (date < now) {
      return 'Pending';
    }
    
    return formatDistanceToNow(date, { addSuffix: true });
  };

  return (
    <div className="h-full flex flex-col bg-vsc-bg">
      {/* Header with Stats */}
      <div className="p-6 border-b border-vsc-border">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-vsc-text flex items-center gap-2">
              <Clock className="text-vsc-blue" size={28} />
              Scheduler & Automation
            </h1>
            <p className="text-sm text-vsc-text-muted mt-1">
              Automate registration, logins, and token refreshes
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant={isRunning ? 'danger' : 'primary'}
              onClick={handleToggleScheduler}
            >
              {isRunning ? (
                <>
                  <Pause size={16} />
                  Stop Scheduler
                </>
              ) : (
                <>
                  <Play size={16} />
                  Start Scheduler
                </>
              )}
            </Button>

            <Button variant="primary" onClick={() => setShowCreateModal(true)}>
              <Plus size={16} />
              New Task
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            icon={<Calendar size={20} />}
            label="Total Tasks"
            value={tasks.length.toString()}
          />
          <StatCard
            icon={<Zap size={20} />}
            label="Scheduler Status"
            value={isRunning ? 'Running' : 'Stopped'}
          />
          <StatCard
            icon={<TrendingUp size={20} />}
            label="Success Rate"
            value={
              tasks.length > 0
                ? `${Math.round((tasks.reduce((sum: number, t: any) => sum + t.successCount, 0) / Math.max(tasks.reduce((sum: number, t: any) => sum + t.runCount, 0), 1)) * 100)}%`
                : '0%'
            }
          />
          <StatCard
            icon={<Clock size={20} />}
            label="Next Run"
            value={
              tasks.filter((t: any) => t.enabled).length > 0
                ? getNextRunLabel(Math.min(...tasks.filter((t: any) => t.enabled).map((t: any) => t.nextRun)))
                : 'None'
            }
          />
        </div>
      </div>

      {/* Tasks List */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-vsc-text-muted">Loading tasks...</div>
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No scheduled tasks"
            description="Create your first automated task to get started"
          />
        ) : (
          <div className="space-y-4">
            {tasks.map((task: any) => {
              const successRate = task.runCount > 0 
                ? (task.successCount / task.runCount) * 100 
                : 0;
              
              return (
                <GlassCard key={task.id} className="p-5 hover:border-vsc-blue/30 transition-all">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <Toggle
                          label=""
                          checked={task.enabled}
                          onChange={enabled => handleToggleTask(task.id, enabled)}
                        />
                        <h3 className="text-lg font-medium text-vsc-text">{task.name}</h3>
                        <StatusBadge 
                          status={task.enabled ? 'active' : 'inactive'} 
                          withDot 
                        />
                        {task.lastError && (
                          <StatusBadge status="error" withDot />
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                        <div>
                          <span className="text-vsc-text-muted">Type:</span>
                          <span className="ml-2 text-vsc-text font-medium">{getTaskTypeLabel(task.taskType)}</span>
                        </div>
                        <div>
                          <span className="text-vsc-text-muted">Schedule:</span>
                          <span className="ml-2 text-vsc-text font-medium">{getScheduleLabel(task.schedule)}</span>
                        </div>
                        <div>
                          <span className="text-vsc-text-muted">Next Run:</span>
                          <span className="ml-2 text-vsc-blue font-medium">{getNextRunLabel(task.nextRun)}</span>
                        </div>
                      </div>

                      {/* Progress Bar for Success Rate */}
                      {task.runCount > 0 && (
                        <div className="mb-3">
                          <ProgressBar 
                            value={successRate}
                            variant={successRate > 80 ? 'success' : successRate > 50 ? 'warning' : 'danger'}
                            showLabel
                            label="Success Rate"
                          />
                        </div>
                      )}

                      {/* Stats */}
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1">
                          <span className="text-vsc-green">✓ {task.successCount}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-vsc-red">✗ {task.errorCount}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-vsc-text-muted">Total: {task.runCount}</span>
                        </div>
                        {task.lastRun && (
                          <div className="flex items-center gap-1">
                            <span className="text-vsc-text-muted">
                              Last: {formatDistanceToNow(new Date(task.lastRun * 1000), { addSuffix: true })}
                            </span>
                          </div>
                        )}
                      </div>

                      {task.lastError && (
                        <div className="mt-3 p-2 bg-vsc-red/10 border border-vsc-red/20 rounded text-xs text-vsc-red">
                          {task.lastError}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      <IconButton
                        onClick={() => handleExecuteNow(task.id)}
                        title="Run now"
                      >
                        <Play size={16} />
                      </IconButton>
                      <IconButton
                        onClick={() => setViewingHistory(task.id)}
                        title="View history"
                      >
                        <Clock size={16} />
                      </IconButton>
                      <IconButton
                        onClick={() => setEditingTask(task.id)}
                        title="Edit"
                      >
                        <Edit size={16} />
                      </IconButton>
                      <IconButton
                        onClick={() => handleDeleteTask(task.id)}
                        title="Delete"
                        variant="danger"
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateTaskModal onClose={() => setShowCreateModal(false)} />
      )}

      {editingTask !== null && (
        <EditTaskModal
          taskId={editingTask}
          onClose={() => setEditingTask(null)}
        />
      )}

      {viewingHistory !== null && (
        <TaskExecutionHistory
          taskId={viewingHistory}
          onClose={() => setViewingHistory(null)}
        />
      )}
    </div>
  );
}
