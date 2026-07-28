import { useEffect, useState } from 'react';
import { getObsTimeline } from '@/lib/backend/modules/observability';

type TimelineEntry = { ts: string; level: string; message: string };

type UseReplayTimelineParams = {
  isOpen: boolean;
  correlationId: string;
  jobId: string | null;
};

export function useReplayTimeline({ isOpen, correlationId, jobId }: UseReplayTimelineParams) {
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineEntries, setTimelineEntries] = useState<TimelineEntry[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    if (!jobId && !correlationId) return;

    let cancelled = false;
    const refreshTimeline = async () => {
      setTimelineLoading(true);
      try {
        const entries = await getObsTimeline({
          correlationId,
          jobId: jobId ?? undefined,
          limit: 160,
        });
        if (cancelled) return;
        setTimelineEntries(
          entries.map(entry => ({
            ts: entry.timestamp,
            level: entry.level,
            message: entry.message,
          }))
        );
      } catch {
        if (!cancelled) setTimelineEntries([]);
      } finally {
        if (!cancelled) setTimelineLoading(false);
      }
    };

    void refreshTimeline();
    const timer = window.setInterval(() => void refreshTimeline(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [correlationId, isOpen, jobId]);

  useEffect(() => {
    if (!isOpen) {
      setTimelineEntries([]);
      setTimelineLoading(false);
    }
  }, [isOpen]);

  return {
    timelineEntries,
    timelineLoading,
  };
}
